"""Parse spell data directly out of the locally-installed game client (F:\\EverquestLegends),
instead of scraping the wiki. Produces data/spells_client_raw.json.

The client ships spells_us.txt: one line per spell, ^-delimited scalar fields, with the final
field itself further delimited (each effect slot is `SLOT|SPA|BASE1|BASE2|CALC|MAX`, slots
joined by `$`). This is the same format used across the EQ client family; field offsets below
were confirmed against https://github.com/rumstil/eqspellparser (actively maintained against the
live client) and cross-checked by hand against known spells (e.g. id 9 "Superior Healing":
mana 185, 3.5s cast, Cleric-usable at level 30, heal effect SPA 0 base 200->600 cap - all matched).

Field count in this client's file (173) is a few more than eqspellparser's documented "current"
format (166), so trailing fields past ~161 are unmapped here (unneeded for this project) - the
effect-slot blob is always read as the *last* ^-field regardless of total count, so it's immune
to that drift.
"""
import json
from pathlib import Path

GAME_DIR = Path(r"F:\EverquestLegends")
DATA_DIR = Path(__file__).parent / "data"

SPELLS_FILE = GAME_DIR / "spells_us.txt"
DBSTR_FILE = GAME_DIR / "dbstr_us.txt"

# dbstr_us.txt is `id^type^text^...`. Type 5 is the spell Category name table (179 entries:
# "HP Buffs", "Regen", "Armor Class", "Symbol", "Shielding", "Haste", "Slow", "Root", ...).
# A spell's fields 86 (category) and 87 (subcategory) index into it - this is the exact
# "spell line" text the client shows on hover, and (crucially) it's the game's own
# cross-class buff-line id: Courage (CLR) and Skin like Wood (DRU) are both
# "HP Buffs / HP type one", so they share a line and don't stack; Symbol of Ryltan is
# "HP Buffs / Symbol", a different line that stacks with Courage.
DBSTR_CATEGORY_TYPE = "5"


def load_category_names() -> dict[str, str]:
    names = {}
    with open(DBSTR_FILE, encoding="latin-1") as fh:
        for line in fh:
            parts = line.rstrip("\n").split("^")
            if len(parts) >= 3 and parts[1] == DBSTR_CATEGORY_TYPE:
                names[parts[0]] = parts[2]
    return names

# Field order 36..51 in spells_us.txt (min level to cast per class, 255 = can't cast)
CLASS_CODES = [
    "WAR", "CLR", "PAL", "RNG", "SHD", "DRU", "MNK", "BRD",
    "ROG", "SHM", "NEC", "WIZ", "MAG", "ENC", "BST", "BER",
]


def parse_line(line: str, category_names: dict[str, str]) -> dict | None:
    fields = line.rstrip("\n").split("^")
    if len(fields) < 60 or not fields[0].isdigit():
        return None

    def i(idx, default=0):
        try:
            return int(fields[idx])
        except (ValueError, IndexError):
            return default

    def f(idx, default=0.0):
        try:
            return float(fields[idx])
        except (ValueError, IndexError):
            return default

    def cat_name(idx):
        # field value is a type-5 dbstr id; 0/blank means "no category on this spell".
        raw = fields[idx] if idx < len(fields) else "0"
        return category_names.get(raw) if raw not in ("", "0") else None

    classes = {}
    for n, code in enumerate(CLASS_CODES):
        lvl = i(36 + n, 255)
        if lvl != 255:
            classes[code] = lvl

    slots = []
    blob = fields[-1]
    for group in blob.split("$"):
        parts = group.split("|")
        if len(parts) < 6:
            continue
        slot_num = int(parts[0]) if parts[0].lstrip("-").isdigit() else None
        spa = int(parts[1]) if parts[1].lstrip("-").isdigit() else None
        if spa is None or spa == 254:  # 254 = unused slot
            continue
        slots.append({
            "slot": slot_num,
            "spa": spa,
            "base1": int(parts[2]) if parts[2].lstrip("-").isdigit() else 0,
            "base2": int(parts[3]) if parts[3].lstrip("-").isdigit() else 0,
            "calc": int(parts[4]) if parts[4].lstrip("-").isdigit() else 0,
            "max": int(parts[5]) if parts[5].lstrip("-").isdigit() else 0,
        })

    return {
        "id": i(0),
        "name": fields[1].strip(),
        "range": f(4),
        "aoe_range": f(5),
        "cast_time_ms": i(8),
        "recovery_ms": i(9),
        "recast_ms": i(10),
        "duration_base": i(11),
        "duration_cap": i(12),
        "mana": i(14),
        "beneficial": bool(i(28)),
        "resist_type": i(29),
        "target_type": i(30),
        "skill": i(32),
        "zone_type": i(33),
        "classes": classes,
        "icon": i(75),
        "interruptable": not bool(i(77)),
        "description_index": i(85),
        # The client's own "spell line" taxonomy (see load_category_names) - the text shown on
        # hover and the game's cross-class buff-line id.
        "line_category": cat_name(86),
        "line_subcategory": cat_name(87),
        "endurance": i(96),
        "group_id": i(132),
        "rank": i(133),
        # SpellGroup (field 165): clusters the same-class tiers of a line (Courage/Center/
        # Bravery/Valor all share one, as do Rk. II/III variants). 0 = ungrouped. Structured as
        # 100 + 2-digit class index + 3-digit line number; stable within this client's 173-field
        # layout even though it sits past eqspellparser's documented ~161-field cutoff.
        "spell_group": i(165) or None,
        "effects": slots,
    }


def main():
    category_names = load_category_names()
    spells = []
    with open(SPELLS_FILE, encoding="latin-1") as fh:
        for line in fh:
            parsed = parse_line(line, category_names)
            if parsed:
                spells.append(parsed)

    out_path = DATA_DIR / "spells_client_raw.json"
    out_path.write_text(json.dumps(spells, indent=1), encoding="utf-8")
    with_line = sum(1 for s in spells if s["line_subcategory"])
    print(f"Parsed {len(spells)} spells -> {out_path}")
    print(f"Loaded {len(category_names)} category names; {with_line} spells carry a spell line")


if __name__ == "__main__":
    main()
