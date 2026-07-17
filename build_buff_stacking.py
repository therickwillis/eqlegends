"""Computes buff-stacking lines for data/buff_stacking.json, primarily from the game client's
own spell-line taxonomy (see extract_client_spells.py).

Primary source - the client's Category/Subcategory (spells_us.txt fields 86/87 -> dbstr_us.txt
type 5, surfaced as `line_id`/`line` on each row). This is the exact "spell line" the client
shows on hover AND the game's own cross-class buff-line id: Courage (CLR) and Skin like Wood
(DRU) are both "HP Buffs / HP type one" -> same line, don't stack; Symbol of Ryltan is
"HP Buffs / Symbol" -> a different line that stacks with Courage. Using it fixes the residual
limitation of the old effect-signature key (below): it couldn't tell apart two lines with an
identical effect signature that sit on different in-game slots, but the client tags those as
distinct subcategories.

Fallback - effect signature. ~27% of client rows carry no category (mostly legacy duplicate
spell entries and a few exotic effects). For those we fall back to the earlier approach: group
by the sorted set of persistent stat SPAs the spell carries, so they still get a line instead of
going Unconfirmed. Two spells share a fallback line only when their signatures match exactly:

    Courage / Center / Valor / Bravery -> (AC, Total HP)      one line
    Symbol of Ryltan / Naltron / ...   -> (Total HP)          a different line

A curated META_SPAS set is excluded from the signature so directives/limiters/one-shots never
define or split a line:
  - CurrentHPOnce (79): one-time heal-on-cast rider.
  - StackingCommand (148/149): the client's own block/overwrite directive, not a stat.
  - Limit* focus modifiers (134-144, 311) and Trigger (475): qualifiers on a focus/proc effect.
A negative-value AC effect also doesn't count as an "AC" claim (a damage-shield-flavored
negative-AC proc shouldn't read as a real AC buff line).

Either way, Bard songs live in their own buff window and never conflict with a non-Bard buff, so
a bard-only line's key is namespaced ("bard:") to only ever collide with other bard songs.

Output (unchanged shape): {spell_name_lowercase: [{"group_id", "label"}, ...]} - always one
entry per name (a spell occupies one line), consumed by parse_effects.py and the app.
"""
import json
from collections import defaultdict
from pathlib import Path

from build_spells_raw import humanize_spa

DATA_DIR = Path(__file__).parent / "data"

ARMOR_CLASS_SPA = 1
CURRENT_HP_ONCE_SPA = 79  # one-time heal-on-cast; value-locked to the maxHP buff, not its own slot
HP_REGEN_SPA = 0          # recurring HP/tick; a line-definer on its own, but a rider inside 69+79
# SPAs that are directives/limiters/one-shots, not persistent buff slots - kept out of every
# fallback signature so they never define or split a line (see docstring).
META_SPAS = {
    CURRENT_HP_ONCE_SPA,  # one-time heal-on-cast rider
    148, 149,  # StackingCommand block / overwrite
    475,       # Trigger_Spell_Non_Item
    *range(134, 145),  # Limit* focus modifiers (LimitMaxLevel ... LimitCastTimeMax)
    311,       # LimitCombatSkills
}

# Long-duration Heal-HoTs (the Regeneration/Chloroplast line, 8-14 min) behave as stacking buffs
# in-game and the UI's buff-template engine treats them as candidates, so they need signatures too.
# Short combat HoTs (Celestial line, ~24s) stay out. Keep in sync with MIN_TEMPLATE_DURATION_S in
# app/rank.js.
MIN_TEMPLATE_HOT_DURATION_S = 300


def is_stacking_relevant(spell: dict) -> bool:
    if spell["category"] == "Buff":
        return True
    return (spell["category"] == "Heal-HoT"
            and spell["duration_seconds"] is not None
            and spell["duration_seconds"] >= MIN_TEMPLATE_HOT_DURATION_S)


def signature_line(group: list, spa_label) -> dict | None:
    """Fallback line for spells with no client category: key on the sorted set of persistent
    stat SPAs (see docstring). Returns {"group_id", "label"} or None if nothing survives."""
    raw_sig = {}
    has_effects = any(s.get("effects") for s in group)
    for spell in group:
        if has_effects:
            for e in spell.get("effects", []):
                if e["spa"] == ARMOR_CLASS_SPA and (e.get("value") or 0) < 0:
                    continue  # a negative-value AC (damage-shield proc) isn't an AC claim
                raw_sig.setdefault(e["spa"], e.get("stat") or spa_label(e["spa"]))
        else:
            for spa in spell.get("spas") or []:
                raw_sig.setdefault(spa, spa_label(spa))

    drop = set(META_SPAS)
    # On the AC+maxHP lines the on-cast heal (79) is value-locked to the maxHP buff, and the top
    # tiers also tack on a tiny HP-regen (0). Both are riders - drop the regen too, but ONLY
    # inside this maxHP+on-cast-heal combo, so the pure HP-regen lines keep their identity.
    if 69 in raw_sig and CURRENT_HP_ONCE_SPA in raw_sig:
        drop.add(HP_REGEN_SPA)

    signature = {spa: lab for spa, lab in raw_sig.items() if spa not in drop}
    if not signature:
        return None
    ordered = sorted(signature)
    return {
        "group_id": f"sig:{'-'.join(str(s) for s in ordered)}",
        "label": " + ".join(signature[s] for s in ordered),
    }


def main():
    # spells_raw.json (not spells.json): parse_effects.py reads this script's output to build
    # spells.json, so reading spells.json here would be circular. spells_raw already carries the
    # cleaned, level-valued effect list and the client line fields this needs.
    rows = json.loads((DATA_DIR / "spells_raw.json").read_text(encoding="utf-8"))
    spa_names = json.loads((DATA_DIR / "spa_effects.json").read_text(encoding="utf-8"))

    def spa_label(spa: int) -> str:
        return humanize_spa(spa_names.get(str(spa), f"SPA{spa}"))

    by_name = defaultdict(list)
    for spell in rows:
        if is_stacking_relevant(spell):
            by_name[spell["name"].lower()].append(spell)

    stacking_map = {}
    from_client = from_signature = 0
    for name, group in by_name.items():
        bard_only = all(s.get("class") == "Bard" for s in group)
        prefix = "bard:" if bard_only else ""

        # Primary: the client's own spell line. Every row for one name is the same spell, so they
        # share a line_id; guard against a rare name collision by taking the most common one.
        line_ids = [s["line_id"] for s in group if s.get("line_id")]
        if line_ids:
            line_id = max(set(line_ids), key=line_ids.count)
            label = next(s["line"] for s in group if s.get("line_id") == line_id)
            stacking_map[name] = [{"group_id": f"{prefix}line:{line_id}", "label": label}]
            from_client += 1
            continue

        # Fallback: effect signature.
        sig = signature_line(group, spa_label)
        if sig is None:
            continue
        sig["group_id"] = prefix + sig["group_id"]
        stacking_map[name] = [sig]
        from_signature += 1

    (DATA_DIR / "buff_stacking.json").write_text(json.dumps(stacking_map, indent=2), encoding="utf-8")
    print(f"Computed buff lines for {len(stacking_map)} spell names "
          f"({len(by_name)} stacking-relevant) -> data/buff_stacking.json")
    print(f"  {from_client} from the client's own spell line, {from_signature} from effect-signature fallback")


if __name__ == "__main__":
    main()
