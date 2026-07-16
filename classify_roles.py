"""Computes a data-driven per-class role-affinity score from data/spells.json.

Answers "which classes actually anchor which playstyle" empirically (spell
count per role), rather than assuming it from game lore - see
docs/PROJECT_GOALS.md for why (the wiki's raw data initially hid Enchanter's
entire Crowd Control kit under a generic "Debuff" category; parse_effects.py
fixes that classification bug, this script is what the fix unblocks).

Output: data/class_roles.json, keyed by class name. Not wired into the UI -
this is a standalone analysis artifact until a playstyle-based UI direction
is decided.
"""
import json
from pathlib import Path

DATA_DIR = Path(__file__).parent / "data"

# Same 5 roles as ROLE_DEFINITIONS in app/compare.js (line ~103-109). Keep in
# sync manually - can't share code across Python/JS. Buff is deliberately
# excluded here too (it has its own separate Buff Loadout feature, not a
# "role" in this rollup).
ROLE_CATEGORIES = {
    "healer": ["Heal-Instant", "Heal-HoT", "Regen", "Cure"],
    "damage": ["Nuke", "DoT", "Lifetap"],
    "crowd_control": ["Charm", "Fear", "Root", "Slow", "Mesmerize"],
    "debuffer": ["Debuff"],
    "support": ["Pet/Summon", "Travel", "Tradeskill", "Utility"],
}

# Classes with no (or effectively no) spell kit in this dataset - Warrior,
# Monk, Berserker have zero spell entries; Rogue has 12, almost all unrelated
# to a real spellcasting role. There's no data signal to score these on, so
# they're excluded entirely rather than given a manual/lore-based label.
EXCLUDED_CLASSES = {"Warrior", "Monk", "Berserker", "Rogue"}

# A role is considered "dominant" for a class if its normalized score is
# within this fraction of that class's own best normalized score - surfaces
# real ties (e.g. Enchanter ties crowd_control/debuffer) instead of an
# arbitrary argmax pick.
DOMINANT_EPSILON = 0.10


def category_to_role(category_to_role_map, category):
    return category_to_role_map.get(category)


def main():
    spells = json.loads((DATA_DIR / "spells.json").read_text(encoding="utf-8"))
    classes = json.loads((DATA_DIR / "classes.json").read_text(encoding="utf-8"))

    cat_to_role = {c: role for role, cats in ROLE_CATEGORIES.items() for c in cats}

    in_scope = [c["name"] for c in classes if c["name"] not in EXCLUDED_CLASSES]

    counts = {cls: {role: 0 for role in ROLE_CATEGORIES} for cls in in_scope}
    for spell in spells:
        cls = spell["class"]
        if cls not in counts:
            continue
        role = cat_to_role.get(spell["category"])
        if role:
            counts[cls][role] += 1

    role_max = {
        role: max((counts[cls][role] for cls in in_scope), default=0)
        for role in ROLE_CATEGORIES
    }

    result = {}
    for cls in in_scope:
        normalized = {
            role: (counts[cls][role] / role_max[role] if role_max[role] else 0.0)
            for role in ROLE_CATEGORIES
        }
        ranked = sorted(ROLE_CATEGORIES, key=lambda r: normalized[r], reverse=True)
        best = normalized[ranked[0]]
        dominant = [r for r in ranked if best - normalized[r] <= DOMINANT_EPSILON] if best > 0 else []

        result[cls] = {
            "counts": counts[cls],
            "normalized": {r: round(v, 3) for r, v in normalized.items()},
            "ranked": ranked,
            "dominant_roles": dominant,
        }

    (DATA_DIR / "class_roles.json").write_text(json.dumps(result, indent=2), encoding="utf-8")

    print(f"Wrote role affinity for {len(result)} classes to data/class_roles.json")
    print(f"Excluded (no/near-no spell data): {sorted(EXCLUDED_CLASSES)}")
    print()
    header = "class".ljust(16) + "".join(role.ljust(16) for role in ROLE_CATEGORIES) + "dominant"
    print(header)
    for cls, data in result.items():
        row = cls.ljust(16) + "".join(f"{data['normalized'][r]:.2f}".ljust(16) for r in ROLE_CATEGORIES)
        row += ", ".join(data["dominant_roles"])
        print(row)


if __name__ == "__main__":
    main()
