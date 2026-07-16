"""Post-process data/spells_raw.json (client-derived, see build_spells_raw.py) into
data/spells.json + data/categories.json.

By the time a spell reaches this script, its category/effects/mana/duration are already fully
computed from the game client. This step just attaches the two remaining wiki-sourced bits
(spell icon, buff-stacking group - both still eqlwiki.com-scraped and out of scope for the
client-data migration) and derives a couple of ranking metrics used by the comparison UI.
"""
import json
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
