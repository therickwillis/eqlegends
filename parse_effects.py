"""Post-process data/spells_raw.json into data/spells.json + data/categories.json.

Adds: parsed numeric effects from the free-text `max_raw` field, a normalized
duration in seconds, an effect category/subcategory, and a couple of derived
metrics (mana efficiency, a rough HoT total) used by the comparison UI.
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

# EQ buffs/DoTs/HoTs tick every 6 seconds; used to estimate HoT/DoT totals
# when the wiki only gives a per-tick value and a duration.
TICK_SECONDS = 6

# Maps the wiki's free-text `kind` field to a small, pragmatic taxonomy.
# Anything not listed falls back to "Other".
KIND_CATEGORY = {
    "Heal": "Heal-Instant", "Healing": "Heal-Instant", "Pet Heal": "Heal-Instant",
    "Heal Over Time": "Heal-HoT", "Duration Heals": "Heal-HoT", "Duraiton Heals": "Heal-HoT",
    "Buff": "Buff", "Beneficial": "Buff", "Utility Beneficial": "Buff",
    "Statistic Buffs": "Buff", "HP Buffs": "Buff", "Pet Buff": "Buff", "Buff/Proc": "Buff",
    "Damage": "Nuke", "Direct Damage": "Nuke", "DD": "Nuke", "DD Cold": "Nuke",
    "Rain DD": "Nuke", "AE DD": "Nuke", "AE DD (quad)": "Nuke", "Rain Dmg": "Nuke",
    "Damage/Root": "Nuke", "Damage/Stun": "Nuke",
    "Damage Over Time": "DoT", "DoT": "DoT", "Dot": "DoT", "DOT": "DoT",
    "DOT Disease": "DoT", "DOT Poison": "DoT", "DoT/Debuff": "DoT", "DoT/Snare": "DoT",
    "Debuff/DoT": "DoT",
    "Detrimental": "Debuff", "Debuff": "Debuff", "Utility Detrimental": "Debuff",
    "Slow": "Debuff", "Fear": "Debuff", "Root": "Debuff", "Weaken": "Debuff", "Dispel": "Debuff",
    "Pet": "Pet/Summon", "Summon": "Pet/Summon", "Pet Summon": "Pet/Summon",
    "Summon Item": "Pet/Summon", "Create Item": "Pet/Summon", "Pet Proc": "Pet/Summon",
    "Pet Haste": "Pet/Summon",
    "Charm": "Charm",
    "Cure": "Cure", "Cure Poison": "Cure",
    "Regen": "Regen", "HP/END/MANA Regen": "Regen",
    "Taps": "Lifetap", "Lifetap": "Lifetap",
    "Travel": "Travel", "Teleport": "Travel",
    "Tradeskill": "Tradeskill",
    "Utility": "Utility", "Mana": "Utility",
}

CATEGORY_DESCRIPTIONS = {
    "Heal-Instant": "Restores HP immediately",
    "Heal-HoT": "Restores HP over time (heal-over-time)",
    "Buff": "Beneficial stat/AC/resist/HP buff",
    "Nuke": "Direct damage spell",
    "DoT": "Damage over time",
    "Debuff": "Detrimental effect on a target (slow, fear, root, dispel, etc.)",
    "Pet/Summon": "Summons a pet or item",
    "Charm": "Charms a target to fight for the caster",
    "Cure": "Cures poison/disease/curse",
    "Regen": "HP/mana/endurance regeneration over time",
    "Lifetap": "Damages target and heals caster",
    "Travel": "Movement speed or teleportation",
    "Tradeskill": "Tradeskill utility",
    "Utility": "Miscellaneous utility effect",
    "Other": "Uncategorized",
}

DURATION_RE = re.compile(r"([\d.]+)\s*(sec|min)", re.IGNORECASE)

# Cascade of regexes for one "<br>"-separated segment of the max_raw field.
EFFECT_PATTERNS = [
    ("per_tick", re.compile(r"^([+-]?\d+(?:\.\d+)?)\s+(.+?)\s*/\s*tick$", re.IGNORECASE)),
    ("range", re.compile(r"^([+-]?\d+)\s*-\s*(\d+)\s+(.+)$")),
    ("cure", re.compile(r"^Cure\s+(\d+)\s+(.+)$", re.IGNORECASE)),
    ("summon_item", re.compile(r"^Summon Item\s*#?\s*(\d+)$", re.IGNORECASE)),
    ("flat_signed", re.compile(r"^([+-]\d+(?:\.\d+)?)\s+(.+)$")),
    ("flat", re.compile(r"^(\d+(?:\.\d+)?)\s+(.+)$")),
    ("status_effect", re.compile(r"^(Fear|Stun|Root|Mesmerize|Charm|Snare)\b(.*)$", re.IGNORECASE)),
]


def parse_duration_seconds(duration_text: str):
    text = (duration_text or "").strip()
    if not text or text.lower() == "instant":
        return 0
    m = DURATION_RE.search(text)
    if m:
        value = float(m.group(1))
        unit = m.group(2).lower()
        return value * 60 if unit == "min" else value
    # Bare number with no unit (a handful of wiki entries omit it) - assume seconds.
    if re.fullmatch(r"[\d.]+", text):
        return float(text)
    return None  # unparseable (e.g. "Until Cancelled")


def parse_mana(mana_text: str) -> int:
    try:
        return int(float((mana_text or "0").strip() or 0))
    except ValueError:
        return 0


def parse_effect_segment(segment: str):
    segment = segment.strip()
    if not segment:
        return None
    for kind, pattern in EFFECT_PATTERNS:
        m = pattern.match(segment)
        if not m:
            continue
        if kind == "per_tick":
            return {"type": "per_tick", "value": float(m.group(1)), "stat": m.group(2).strip(), "raw": segment}
        if kind == "range":
            return {"type": "range", "min": int(m.group(1)), "max": int(m.group(2)),
                     "stat": m.group(3).strip(), "raw": segment}
        if kind == "cure":
            return {"type": "cure", "value": int(m.group(1)), "stat": m.group(2).strip(), "raw": segment}
        if kind == "summon_item":
            return {"type": "summon_item", "item_id": m.group(1), "raw": segment}
        if kind in ("flat_signed", "flat"):
            return {"type": "flat", "value": float(m.group(1)), "stat": m.group(2).strip(), "raw": segment}
        if kind == "status_effect":
            return {"type": "status_effect", "stat": m.group(1).strip(), "raw": segment}
    return {"type": "raw", "raw": segment}


def parse_max_raw(max_raw: str):
    if not max_raw or max_raw.strip() in ("", "-"):
        return []
    segments = re.split(r"<br\s*/?>", max_raw)
    return [e for e in (parse_effect_segment(s) for s in segments) if e]


# A handful of HoT lines (Druid "*Heal", Shaman "*Healing"/"Nonchalance") leave
# `max` blank and only state the per-tick amount in the prose description, e.g.
# "healing for 60 every 6 seconds for 24 seconds and then healing for 197." or
# "healing 60 hit points every 6 seconds for 24s, ...". Explicit reported totals
# (when present) are trusted over a computed estimate, since ticks don't always
# divide the duration evenly.
DESCRIPTION_HOT_RE = re.compile(
    r"healing (?:for |for )?(\d+)(?: hit points)? (?:every|per) (\d+) seconds?"
    r" for (\d+)\s*s(?:econds)?(?:.*?and then healing (?:for )?(\d+))?",
    re.IGNORECASE,
)


def parse_hot_from_description(description: str, duration_seconds):
    m = DESCRIPTION_HOT_RE.search(description or "")
    if not m:
        return None, None
    per_tick = float(m.group(1))
    tick_interval = float(m.group(2))
    explicit_total = float(m.group(4)) if m.group(4) else None
    effect = {"type": "per_tick", "value": per_tick, "stat": "HP",
              "raw": m.group(0), "source": "description"}
    if explicit_total is not None:
        return effect, explicit_total
    if duration_seconds:
        ticks = max(1, round(duration_seconds / tick_interval))
        return effect, per_tick * ticks
    return effect, None


def effect_numeric_value(effect: dict):
    if effect["type"] == "range":
        return effect["max"]
    if effect["type"] in ("flat", "per_tick", "cure"):
        return effect["value"]
    return None


def classify(spell: dict, effects: list, duration_seconds):
    category = KIND_CATEGORY.get(spell["kind"], "Other")
    # Refine Heal: a "Heal"-kind spell with a real (non-instant) duration and a
    # per-tick effect is actually a HoT even if the wiki tagged it plain "Heal".
    if category == "Heal-Instant" and duration_seconds and any(e["type"] == "per_tick" for e in effects):
        category = "Heal-HoT"
    return category


def build_metrics(spell: dict, effects: list, category: str, duration_seconds, mana: int,
                   explicit_total=None):
    primary = next((e for e in effects if effect_numeric_value(e) is not None), None)
    primary_value = effect_numeric_value(primary) if primary else None
    primary_stat = primary.get("stat") if primary else None

    total_effect = primary_value
    if category == "Heal-HoT":
        per_tick = next((e for e in effects if e["type"] == "per_tick"), None)
        if per_tick:
            primary_value = per_tick["value"]
            primary_stat = per_tick["stat"]
            if explicit_total is not None:
                total_effect = explicit_total
            elif duration_seconds:
                ticks = max(1, round(duration_seconds / TICK_SECONDS))
                total_effect = per_tick["value"] * ticks

    mana_efficiency = (total_effect / mana) if (total_effect is not None and mana > 0) else None

    return {
        "primary_stat": primary_stat,
        "primary_value": primary_value,
        "total_effect": total_effect,
        "mana_efficiency": round(mana_efficiency, 3) if mana_efficiency is not None else None,
    }


def main():
    raw = json.loads((DATA_DIR / "spells_raw.json").read_text(encoding="utf-8"))

    enriched = []
    for spell in raw:
        mana = parse_mana(spell["mana"])
        duration_seconds = parse_duration_seconds(spell["duration"])
        effects = parse_max_raw(spell["max_raw"])
        category = classify(spell, effects, duration_seconds)

        explicit_total = None
        if category == "Heal-HoT" and not any(e["type"] == "per_tick" for e in effects):
            fallback_effect, explicit_total = parse_hot_from_description(
                spell["description"], duration_seconds)
            if fallback_effect:
                effects = effects + [fallback_effect]

        metrics = build_metrics(spell, effects, category, duration_seconds, mana, explicit_total)

        enriched.append({
            **spell,
            "mana": mana,
            "duration_seconds": duration_seconds,
            "effects": effects,
            "category": category,
            **metrics,
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
