"""Computes real buff-stacking conflicts directly from the game client's effect data, replacing
the eqlwiki.com Buff Lines page scrape (buff_stacking.py) as the source for data/buff_stacking.json.

Why not the wiki: its hand-curated Buff Lines page has real coverage gaps - Protection of Wood,
Disempower, Feral Spirit and ~165 other simple buffs were never added to it, so they showed up
"Unconfirmed" in the UI despite there being more than enough data to know their line.

The grouping key is a spell's whole EFFECT SIGNATURE - the sorted set of persistent stat SPAs it
carries - not each SPA independently. Two spells are the same buff line (and so don't stack) only
when their signatures match exactly:

    Courage / Center / Valor / Bravery -> (AC, Total HP)      one line
    Symbol of Ryltan / Naltron / ...   -> (Total HP)          a different line
    -> Courage and Symbol DON'T share a signature, so they correctly STACK in-game.

This fixes the failure of the earlier SPA-only key, which put every Total-HP buff in one group and
so wrongly treated the pure-HP Symbol line as conflicting with the AC+HP Blessing line. It also
still merges what should merge: every AC+HP combo (Courage, Skin like Wood, Protection of Wood,
Temperance...) shares the (AC, Total HP) signature and so conflicts, matching the wiki's old
"AC (Slot 1)" grouping - something a raw per-slot-index comparison (EQEmu's Mob::CheckStackConflict)
misses, because those combos put AC in slot 1 vs slot 2 as a coin flip.

Signature source: spells_raw.json's cleaned `effects` (0-value dead slots and non-stat meta already
stripped, values level-resolved) when a spell has any displayed effect. Some real buffs surface NO
displayed effect because they use exotic SPAs the display layer doesn't render (ManaPool, ReverseDS,
NegateAttacks, focus haste, familiars - the "Blessing of ...", "Gift of Magic", "Ward of ..." lines);
for those we fall back to the raw `spas` list so they still get a signature instead of going
Unconfirmed. Either way a curated META_SPAS set is excluded so directives/limiters/one-shots never
define or split a line:
  - CurrentHPOnce (79): one-time heal-on-cast rider, the only thing separating the Blessing line's
    (AC, Total HP, +79) from the Skin/Protection lines' (AC, Total HP) - dropping it collapses them
    into the one AC+HP line they are in-game.
  - StackingCommand (148/149): the client's own block/overwrite directive, not a stat. Left in, it
    would split Temperance (which carries it) off from the AC+HP line it belongs to.
  - Limit* focus modifiers (134-144, 311) and Trigger (475): qualifiers on a focus/proc effect, not
    standalone buff slots.
A negative-value AC effect also doesn't count as an "AC" claim (a damage-shield-flavored negative-AC
proc shouldn't read as a real AC buff line).

Bard songs live in their own buff window and never conflict with a non-Bard buff, so a bard-only
line's signature is namespaced ("bard:") to only ever collide with other bard songs.

Rider effects that ride an AC+maxHP buff without defining a new line are dropped so a line stays
whole across its tiers: the on-cast heal (79, always) and the top-tier HP-regen (0, only when the
69+79 combo is present). This keeps the Skin/Protection lines intact from Wood (AC, maxHP) through
Diamond (+on-cast heal) up to Nature (+regen), instead of the top tiers fragmenting off and
over-stacking with their own line. The regen drop is deliberately scoped to the maxHP combo so the
pure HP-regen lines (Regeneration/Chloroplast/Lich) keep their identity.

Residual limitation (accepted): the signature still can't tell apart two lines that share an
identical signature but sit on different in-game slots (e.g. "AC Slot 1" vs "AC Slot 4") - only the
hand-curated wiki cells could separate those, and they're rare in classic-era content. As this tool
helps decide what to memorize, occasionally over-flagging such a conflict is safer than telling you
two buffs stack when they don't.
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
# signature so they never define or split a line (see docstring).
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


def main():
    # spells_raw.json (not spells.json): parse_effects.py reads this script's output to build
    # spells.json, so reading spells.json here would be circular. spells_raw already carries the
    # cleaned, level-valued effect list this needs.
    rows = json.loads((DATA_DIR / "spells_raw.json").read_text(encoding="utf-8"))
    spa_names = json.loads((DATA_DIR / "spa_effects.json").read_text(encoding="utf-8"))

    def spa_label(spa: int) -> str:
        return humanize_spa(spa_names.get(str(spa), f"SPA{spa}"))

    by_name = defaultdict(list)
    for spell in rows:
        if is_stacking_relevant(spell):
            by_name[spell["name"].lower()].append(spell)

    stacking_map = {}
    for name, group in by_name.items():
        # Gather the spell's raw persistent-effect SPAs (label per SPA). Prefer the cleaned
        # `effects` (dead 0-value slots already stripped); only if no row surfaced any displayed
        # effect do we fall back to the raw `spas` list - those are the exotic effect-less buffs
        # (Blessing of ..., Gift of Magic, Ward of ...) that would otherwise be Unconfirmed.
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
        # tiers (Skin/Protection of Nature) also tack on a tiny HP-regen (0). Both are riders that
        # don't change the line, so drop the regen too - but ONLY inside this maxHP+on-cast-heal
        # combo, so the pure HP-regen lines (Regeneration/Chloroplast/Lich, which have no maxHP)
        # keep their identity.
        if 69 in raw_sig and CURRENT_HP_ONCE_SPA in raw_sig:
            drop.add(HP_REGEN_SPA)

        signature = {spa: lab for spa, lab in raw_sig.items() if spa not in drop}
        if not signature:
            continue
        ordered = sorted(signature)
        prefix = "bard:" if all(s.get("class") == "Bard" for s in group) else ""
        stacking_map[name] = [{
            "group_id": f"{prefix}combo:{'-'.join(str(s) for s in ordered)}",
            "label": " + ".join(signature[s] for s in ordered),
        }]

    (DATA_DIR / "buff_stacking.json").write_text(json.dumps(stacking_map, indent=2), encoding="utf-8")
    print(f"Computed buff-line signatures for {len(stacking_map)} spell names "
          f"({len(by_name)} stacking-relevant) -> data/buff_stacking.json")


if __name__ == "__main__":
    main()
