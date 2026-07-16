"""Experimental: ranks spells within a category by an archetype-weighted stat
score, instead of the single-scalar `spellPower` (`total_effect`/
`primary_value`) used elsewhere in the app.

Why: `spellPower` only reflects a spell's *first* parsed effect. A combo buff
like Cleric's Courage (+3 AC, +20 Max HP, +11-20 HP on cast) currently scores
"3" - the AC value alone - silently ignoring the HP effects. 34% of Buff-
category spells (87/258) carry 2+ distinct stats, so this isn't an edge case.
It also can't rank across incommensurable stats (a +40 ATK buff vs a +40
Poison Resist buff) except by raw number, which is meaningless once the
stats differ (see docs/PROJECT_GOALS.md's "best spell" caveat).

This script sums *every* numeric effect on a spell, each multiplied by a
per-stat weight (points per unit of that stat), so a combo buff's full value
is counted, and different stats become comparable on the same point scale.

The weight tables below are a **first-draft placeholder**, explicitly meant
to be tuned - the point values encode an opinion about what a given
archetype cares about, not a measured fact. Reuses the archetype vocabulary
already established in app/compare.js's ROLE_DEFINITIONS /
classify_roles.py's ROLE_CATEGORIES (Healer/Damage/Crowd Control/Debuffer/
Support), rather than inventing a 6th taxonomy.
"""
import json
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"

DEFAULT_WEIGHT = 0.3  # fallback for any stat not covered by a group or override below

# Groups the raw wiki stat vocabulary (data/spells.json effect "stat" values)
# by what it actually *does* for a player, not by wiki wording. An archetype's
# weight for a stat is normally just its group's weight - individual stats
# only need an explicit override when they genuinely diverge from the rest of
# their group for a given archetype (e.g. WIS vs INT for a Healer).
STAT_GROUPS = {
    # Direct HP pool/restoration.
    "HP": "heal", "Max HP": "heal",
    # Resource/regen that keeps you going over time rather than topping you
    # off once - this is what actually reduces a Healer's ongoing workload.
    "HP Regen": "sustain", "HP/End Regen": "sustain", "Mana": "sustain",
    # Reduces/prevents incoming damage outright.
    "AC": "mitigation", "Damage Shield": "mitigation",
    "Invul": "mitigation", "Absorption": "mitigation", "Dmg Absorb": "mitigation",
    # Situational, damage-type-specific mitigation.
    "Magic Resist": "resist", "Cold Resist": "resist", "Fire Resist": "resist",
    "Poison Resist": "resist", "Disease Resist": "resist",
    # Offense output stats.
    "ATK": "damage", "STR": "damage", "AGI": "damage", "DEX": "damage", "Dmg": "damage",
    # Caster/spell-effectiveness stats.
    "WIS": "caster_stat", "INT": "caster_stat",
    # Everything else - social/misc, not a combat-role signal either way.
    "STA": "misc", "CHA": "misc", "Hate Reduction": "misc",
}

# points per group, per archetype - PLACEHOLDER, tune freely. Missing groups
# fall back to DEFAULT_WEIGHT.
GROUP_WEIGHTS = {
    "healer": {"heal": 1.0, "sustain": 2.0, "mitigation": 0.6, "resist": 0.5,
               "damage": 0.3, "caster_stat": 1.5, "misc": 0.4},
    "damage": {"heal": 0.5, "sustain": 0.8, "mitigation": 0.3, "resist": 0.3,
               "damage": 1.5, "caster_stat": 0.3, "misc": 0.2},
    "support": {"heal": 1.2, "sustain": 2.0, "mitigation": 1.2, "resist": 1.0,
                "damage": 0.4, "caster_stat": 0.5, "misc": 0.6},
    # Left low-effort for now (barely touch Buff-category spells for their
    # core job) - flat default rather than a tuned group table.
    "crowd_control": {},
    "debuffer": {},
}

# Per-stat exceptions where a stat genuinely diverges from its group's default
# for a given archetype. Sparse by design - only add an entry here when the
# group weight alone would be wrong.
STAT_OVERRIDES = {
    "healer": {
        "WIS": 2.0, "INT": 1.0,  # a Healer cares about its own casting stat, not INT
        "HP Regen": 3.0,  # pure HP regen beats End-inclusive regen for a Healer specifically
    },
    "damage": {
        "ATK": 2.0, "STR": 1.5,  # ATK/STR matter more than AGI/DEX for raw damage
    },
}


def stat_weight(archetype, stat):
    override = STAT_OVERRIDES.get(archetype, {}).get(stat)
    if override is not None:
        return override
    group = STAT_GROUPS.get(stat)
    if group is not None:
        weight = GROUP_WEIGHTS.get(archetype, {}).get(group)
        if weight is not None:
            return weight
    return DEFAULT_WEIGHT


def effect_value(effect):
    return effect.get("value")


def deduped_effects(spell):
    """Each effect now comes from a distinct client spell-file slot (SPA id), not from
    re-parsing free wiki text, so the old HP/Max-HP double-counting this used to guard
    against (two wiki lines describing the same underlying stat) no longer applies."""
    return spell.get("effects", [])


def weighted_score(spell, archetype):
    breakdown = []
    total = 0.0
    for e in deduped_effects(spell):
        value = effect_value(e)
        if value is None:
            continue
        weight = stat_weight(archetype, e["stat"])
        # Damage-ish categories (Nuke/DoT/Debuff) store some effects as
        # negative numbers (see docs/PROJECT_GOALS.md) - rank by magnitude,
        # not signed value, matching categoryGrid()'s Math.abs() convention
        # in app/compare.js. `value` (signed) is still kept in the breakdown
        # for clarity.
        points = abs(value) * weight
        total += points
        breakdown.append((e["stat"], value, weight, points))
    return total, breakdown


def rank_category(spells, category, archetype, top_n=15):
    candidates = [s for s in spells if s["category"] == category]
    scored = []
    for s in candidates:
        score, breakdown = weighted_score(s, archetype)
        scored.append((score, s, breakdown))
    scored.sort(key=lambda t: t[0], reverse=True)
    return scored[:top_n]


def main():
    spells = json.loads((DATA_DIR / "spells.json").read_text(encoding="utf-8"))

    for archetype in ("healer", "damage", "support"):
        print(f"=== Top Buff spells for archetype: {archetype} ===")
        for score, spell, breakdown in rank_category(spells, "Buff", archetype, top_n=10):
            stats = ", ".join(f"{stat} {value:+g}*{weight:g}={points:.1f}" for stat, value, weight, points in breakdown)
            print(f"  {score:6.1f}  {spell['class']:14s} {spell['name']:28s} [{stats}]")
        print()


if __name__ == "__main__":
    main()
