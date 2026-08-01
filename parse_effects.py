"""Post-process data/spells_raw.json (client-derived, see build_spells_raw.py) into
data/spells.json + data/categories.json.

By the time a spell reaches this script, its category/effects/mana/duration are already fully
computed from the game client. This step just attaches the two remaining wiki-sourced bits
(spell icon, buff-stacking group - both still eqlwiki.com-scraped and out of scope for the
client-data migration) and derives a couple of ranking metrics used by the comparison UI.
"""
import json
import re
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"
APP_DIR = Path(__file__).parent / "app"

# (class name, short code, archetype) - from https://eqlwiki.com/Character_Classes
CLASS_INFO = [
    ("Enchanter", "ENC", "Casters"), ("Magician", "MAG", "Casters"),
    ("Necromancer", "NEC", "Casters"), ("Wizard", "WIZ", "Casters"),
    ("Cleric", "CLR", "Priests"), ("Druid", "DRU", "Priests"), ("Shaman", "SHM", "Priests"),
    ("Berserker", "BER", "Melee"), ("Monk", "MNK", "Melee"),
    ("Rogue", "ROG", "Melee"), ("Warrior", "WAR", "Melee"),
    ("Bard", "BRD", "Hybrids"), ("Beastlord", "BST", "Hybrids"),
    ("Paladin", "PAL", "Hybrids"), ("Ranger", "RNG", "Hybrids"),
    ("Shadow Knight", "SHD", "Hybrids"),
]

# EQ buffs/DoTs/HoTs tick every 6 seconds; used to turn a per-tick effect + duration into a
# total (e.g. a HoT's full heal over its lifetime).
TICK_SECONDS = 6

CATEGORY_DESCRIPTIONS = {
    "Heal-Instant": "Restores HP immediately",
    "Heal-HoT": "Restores HP over time (heal-over-time)",
    "Buff": "Beneficial stat/AC/resist/HP buff",
    "Nuke": "Direct damage spell",
    "DoT": "Damage over time",
    "Debuff": "Detrimental effect on a target (stat/AC reduction, dispel, weaken, etc.)",
    "Slow": "Reduces a target's attack/movement speed",
    "Fear": "Makes a target flee in terror",
    "Root": "Immobilizes a target",
    "Mesmerize": "Incapacitates a target until damaged or the effect breaks",
    "Pet/Summon": "Summons a pet or item",
    "Charm": "Charms a target to fight for the caster",
    "Cure": "Cures poison/disease/curse",
    "Lifetap": "Damages target and heals caster",
    "Travel": "Movement speed or teleportation",
    "Utility": "Miscellaneous utility effect",
    "Other": "Uncategorized",
}


def format_duration(duration_seconds) -> str:
    if duration_seconds is None:
        return "Permanent"
    if duration_seconds == 0:
        return "Instant"
    if duration_seconds >= 60:
        minutes = duration_seconds / 60
        return f"{minutes:.0f} Min" if minutes == int(minutes) else f"{minutes:.1f} Min"
    return f"{duration_seconds:.0f} Sec"


def duration_phrase(duration_seconds) -> str:
    """Natural-language duration for the %z token inside a spell's prose description
    ("...for %z" -> "...for 9 minutes"). Prose reads better lowercase and spelled out than the
    compact "9 Min" the stat line uses."""
    if not duration_seconds:
        return "a short time"
    if duration_seconds >= 60:
        minutes = duration_seconds / 60
        if minutes == int(minutes):
            return f"{minutes:.0f} minute" if minutes == 1 else f"{minutes:.0f} minutes"
        return f"{minutes:.1f} minutes"
    return f"{duration_seconds:.0f} second" if duration_seconds == 1 else f"{duration_seconds:.0f} seconds"


def finalize_description(text: str, duration_seconds) -> str:
    """Finish the client prose description that extract_client_spells.py started: it already
    resolved the per-slot #N/@N/$N value tokens; here we substitute the duration (%z) and tidy the
    handful of rarer tokens that reference data we don't carry (%T/%i target counts -> "several";
    %N proc skill names and {NN} type refs -> dropped) so no raw placeholder ever reaches the UI."""
    if not text:
        return text
    text = text.replace("%z", duration_phrase(duration_seconds))
    text = text.replace("%T", "several").replace("%i", "several")
    text = re.sub(r"\{\d+\}", "", text)   # {NN} skill/resist-type name references
    text = re.sub(r"%[A-Za-z]", "", text)  # any residual token (e.g. %N proc skill name)
    # Slot tokens left unresolved by extract_client_spells.py (an id-bearing SPA, e.g. a proc's
    # linked-spell slot) - drop them rather than surface a raw internal id.
    text = re.sub(r"[#@$]\d+", "", text)
    text = text.replace("*", "")
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s+([.,;])", r"\1", text)  # de-space punctuation left by a dropped token
    # Tidy the few sentence fragments left when a linked-spell reference (a weapon proc, an
    # illusion's granted stats) was dropped, so nothing reads as a broken stub. These are general
    # grammar fixes, not per-spell text: an emptied proc clause becomes "a special attack"; a
    # dangling "up to" with no number, or a trailing preposition before the period, is removed.
    text = re.sub(r",?\s*a\s+attack", " a special attack", text)
    text = text.replace("the form a ", "the form of a ")
    text = re.sub(r"\bup to (damage|hit points|mana|health)\b", r"\1", text)
    text = re.sub(r"\s+up to level(?!\s*\d)", "", text)  # stripped level cap that had no number
    text = re.sub(r"\s+for seconds\b", "", text)          # stripped duration that had no number
    text = re.sub(r"\s+over level(?!\s*\d)", "", text)    # stripped max-level limit that had no number
    # Stripped percentage values (the number sat on a SPA we don't render): reword so the sentence
    # still reads without inventing a figure. "% of the ..." -> "a portion of the ..."; "healed by
    # %" -> "healed by a percentage"; a now-empty "up to" before punctuation is dropped.
    text = re.sub(r"(?<!\d)%\s+of\b", "a portion of", text)
    text = re.sub(r"\bby (?!\d)%", "by a percentage", text)
    text = re.sub(r"\bup to(?=\s*[.,])", "", text)
    text = re.sub(r"(?<!\d)\s*%", "", text)               # any other dangling bare % (no number)
    # Drop trailing prepositions left before a period, repeatedly - a stripped clause can leave a
    # chain ("...spells by up to." -> "...spells by." -> "...spells.").
    while True:
        stripped = re.sub(r"[\s,]+(and granting|granting|healing for|for|by|of|up to)\s*\.", ".", text)
        if stripped == text:
            break
        text = stripped
    text = re.sub(r"\.\s+([a-z])", lambda m: ". " + m.group(1).upper(), text)  # recapitalize after a reworded split
    return text


def build_metrics(effects: list, category: str, duration_seconds, mana: int):
    """Picks the "primary" effect (first non-zero one) for display, and derives a mana
    efficiency ratio. For recurring effects (HoT/DoT), totals the per-tick value over the
    spell's full duration rather than reporting just one tick's worth.

    Skips zero-value slots (e.g. Feral Spirit's client data lists an unused/scaling-not-yet-
    active CHA slot at 0 ahead of its real +STR/+Haste/+AC effects) - a real effect always
    sorts first once those are skipped, same reasoning as classify_spell's zero-value guard
    in build_spells_raw.py."""
    primary = next((e for e in effects if e["value"] != 0), None)
    primary_stat = primary["stat"] if primary else None
    primary_value = primary["value"] if primary else None

    total_effect = primary_value
    if primary and category in ("Heal-HoT", "DoT") and duration_seconds:
        ticks = max(1, round(duration_seconds / TICK_SECONDS))
        total_effect = primary_value * ticks

    mana_efficiency = (total_effect / mana) if (total_effect is not None and mana > 0) else None

    return {
        "primary_stat": primary_stat,
        "primary_value": primary_value,
        "total_effect": total_effect,
        "mana_efficiency": round(mana_efficiency, 3) if mana_efficiency is not None else None,
    }


def main():
    raw = json.loads((DATA_DIR / "spells_raw.json").read_text(encoding="utf-8"))
    icons_path = DATA_DIR / "spell_icons.json"
    spell_icons = json.loads(icons_path.read_text(encoding="utf-8")) if icons_path.exists() else {}
    stacking_path = DATA_DIR / "buff_stacking.json"
    buff_stacking = json.loads(stacking_path.read_text(encoding="utf-8")) if stacking_path.exists() else {}

    enriched = []
    for spell in raw:
        metrics = build_metrics(spell["effects"], spell["category"], spell["duration_seconds"], spell["mana"])
        # Heal-HoT included because build_buff_stacking.py computes groups for the
        # long-duration Regeneration/Chloroplast line too (its dict simply has no entry for
        # short combat HoTs, so those still come out empty).
        stacking_groups = (buff_stacking.get(spell["name"].lower(), [])
                           if spell["category"] in ("Buff", "Heal-HoT") else [])

        enriched.append({
            **spell,
            "duration": format_duration(spell["duration_seconds"]),
            "icon": spell_icons.get(spell["name"]),
            "stacking_groups": stacking_groups,
            "stacking_confirmed": bool(stacking_groups),
            **metrics,
            # Overrides the raw pass-through from spells_raw.json (%z/count tokens still unresolved).
            "description_text": finalize_description(spell.get("description_text", ""), spell["duration_seconds"]),
        })

    (DATA_DIR / "spells.json").write_text(json.dumps(enriched, indent=2), encoding="utf-8")

    categories_used = sorted(set(s["category"] for s in enriched))
    categories_out = {c: CATEGORY_DESCRIPTIONS.get(c, "Uncategorized") for c in categories_used}
    (DATA_DIR / "categories.json").write_text(json.dumps(categories_out, indent=2), encoding="utf-8")

    classes_out = [{"name": n, "code": c, "archetype": a} for n, c, a in CLASS_INFO]
    (DATA_DIR / "classes.json").write_text(json.dumps(classes_out, indent=2), encoding="utf-8")

    # Also emit a plain <script>-loadable copy so the UI works when opened
    # directly as a file:// page (no server, no fetch()/CORS issues).
    APP_DIR.mkdir(exist_ok=True)
    data_js = (
        f"const SPELLS = {json.dumps(enriched)};\n"
        f"const CATEGORIES = {json.dumps(categories_out)};\n"
        f"const CLASSES = {json.dumps(classes_out)};\n"
    )
    (APP_DIR / "data.js").write_text(data_js, encoding="utf-8")

    print(f"Wrote {len(enriched)} enriched spells to data/spells.json")
    print(f"Categories: {list(categories_out)}")
    print("Wrote app/data.js for the static UI")


if __name__ == "__main__":
    main()
