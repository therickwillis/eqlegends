"""Build data/spells_raw.json from data/spells_wiki_index.json (see scrape.py) + game client
data. The wiki index is used purely as an INDEX (which spell names exist, for which classes, at
roughly what level); the game client is the sole source of truth for every number, effect, and
category. Run after scrape.py and extract_client_spells.py.

Why an index at all: the client's spells_us.txt is the full modern live-EQ spell database (see
extract_client_spells.py) - tens of thousands of spells spanning 25+ years of expansions, not
just what this classic-style server actually teaches. Which subset is "really in EQ Legends" is
a server-side policy (trainer lists, level cap) that isn't present in any client-side file, so
there's no way to derive it from the game install alone. The wiki, built by the EQ Legends
community against the actual live server, is the only available source for that curation.

Everything else about the wiki is treated as unreliable (see PROJECT_GOALS.md) and is not used:
no mana/duration/effect text, no `kind` category, no description. All of that is computed fresh
from the client via eq_spell_formulas.py and a from-scratch SPA-based classifier. A wiki row
with no confident client match is dropped rather than falling back to wiki numbers.
"""
import json
from collections import Counter
from pathlib import Path

from eq_spell_formulas import calc_duration_ticks, calc_effect_value, DURATION_PERMANENT, DURATION_PERMANENT_AURA

DATA_DIR = Path(__file__).parent / "data"

# scrape.py's class names -> extract_client_spells.py's class codes
CLASS_NAME_TO_CODE = {
    "Bard": "BRD", "Beastlord": "BST", "Berserker": "BER", "Cleric": "CLR",
    "Druid": "DRU", "Enchanter": "ENC", "Magician": "MAG", "Monk": "MNK",
    "Necromancer": "NEC", "Paladin": "PAL", "Ranger": "RNG", "Rogue": "ROG",
    "Shadow Knight": "SHD", "Shaman": "SHM", "Warrior": "WAR", "Wizard": "WIZ",
}

# Client level values used as "not really learned through normal leveling" sentinels
# (AA-granted / item-click duplicates of a spell that also has a normal trainer-taught
# version). Preferred candidates exclude these; used only as a last resort.
SENTINEL_LEVELS = {254, 250}

TARGET_TYPES = {
    1: "Line of Sight", 2: "Caster AE", 3: "Caster's Group", 4: "Caster PB AE", 5: "Single",
    6: "Self", 8: "Targeted AE", 9: "Animal", 10: "Undead", 11: "Summoned", 13: "Lifetap",
    14: "Pet", 15: "Corpse", 16: "Plant", 17: "Giants", 18: "Dragons",
    20: "Targeted AE Lifetap", 21: "Targeted AE Undead", 25: "Targeted AE Summoned",
    32: "Hatelist", 33: "Hatelist", 34: "Chest", 35: "Muramites", 36: "Caster PB (Players)",
    37: "Caster PB (NPCs)", 38: "Pet", 39: "Group (No Pets)", 40: "Caster AE (Players)",
    41: "Target's Group", 42: "Directional AE", 43: "Single in Group", 44: "Frontal AE",
    45: "Targeted Ring AE", 46: "Target's Target", 47: "Pet's Owner",
    50: "Targeted AE (No Players' Pets)", 51: "Single Ally or Self", 52: "Single Ally or Target's Target",
}

# The client's ~30 target types collapsed into the two questions that actually decide whether two
# spells are rivals:
#
#   scope    - how many bodies does this land on? self / single / group / aoe / pet. This is the
#              comparison key: a single-target nuke and an AE nuke are not competing for one slot,
#              you memorize both, so the UI partitions on it instead of ranking across it.
#   restrict - WHICH bodies is it even allowed to touch (undead, animals, summoned, ...)? A
#              separate axis: "Expulse Undead" is an ordinary single-target spell that happens to
#              be useless on most mobs, which is a different fact from how wide it is.
#
# `shape` is descriptive detail for the AE scopes only (is the circle centered on you or on your
# target?) - it never affects grouping, just what the chip and tooltip say.
TARGET_SCOPE = {
    # id: (scope, shape, restrict)
    1: ("single", None, None),          # Line of Sight
    2: ("aoe", "pb", None),             # Caster AE
    3: ("group", None, None),           # Caster's Group
    4: ("aoe", "pb", None),             # Caster PB AE
    5: ("single", None, None),          # Single
    6: ("self", None, None),            # Self
    8: ("aoe", "targeted", None),       # Targeted AE
    9: ("single", None, "animal"),
    10: ("single", None, "undead"),
    11: ("single", None, "summoned"),
    13: ("single", None, None),         # Lifetap - single-target, the tap is the effect not the target
    14: ("pet", None, None),
    15: ("single", None, "corpse"),
    16: ("single", None, "plant"),
    17: ("single", None, "giant"),
    18: ("single", None, "dragon"),
    20: ("aoe", "targeted", None),      # Targeted AE Lifetap
    21: ("aoe", "targeted", "undead"),
    25: ("aoe", "targeted", "summoned"),
    32: ("aoe", "hatelist", None),
    33: ("aoe", "hatelist", None),
    34: ("single", None, None),         # Chest
    35: ("single", None, "muramite"),
    36: ("aoe", "pb", None),            # Caster PB (Players)
    37: ("aoe", "pb", None),            # Caster PB (NPCs)
    38: ("pet", None, None),
    39: ("group", None, None),          # Group (No Pets)
    40: ("aoe", "pb", None),            # Caster AE (Players)
    41: ("group", None, None),          # Target's Group
    42: ("aoe", "frontal", None),       # Directional AE
    43: ("single", None, None),         # Single in Group
    44: ("aoe", "frontal", None),       # Frontal AE
    45: ("aoe", "ring", None),          # Targeted Ring AE
    46: ("single", None, None),         # Target's Target
    47: ("single", None, None),         # Pet's Owner
    50: ("aoe", "targeted", None),      # Targeted AE (No Players' Pets)
    51: ("single", None, None),         # Single Ally or Self
    52: ("single", None, None),         # Single Ally or Target's Target
}

def derive_target(client_spell: dict) -> dict:
    """Structured target facts: scope (the comparison key), plus the detail the UI shows.

    Unmapped target-type ids fall back on the client's own AE radius, which is the physical
    truth regardless of what the id means: a spell with an AE radius hits an area, one without
    hits one thing. This currently covers exactly one id - **type 56**, ten beneficial SHM/DRU
    single-target spells (Scale of Wolf, Stoicism, the Snails/Tortoises/Slugs Healing line) that
    this client uses and rumstil/eqspellparser doesn't document. They all carry range 100 / AE
    radius 0, so the fallback lands them on `single`, which matches how they actually cast. The
    raw `target` label stays "Type 56" so the gap stays visible rather than being papered over.
    """
    target_type = client_spell["target_type"]
    aoe_radius = client_spell.get("aoe_range") or 0
    scope, shape, restrict = TARGET_SCOPE.get(
        target_type, ("aoe" if aoe_radius > 0 else "single", None, None)
    )
    return {
        "target_type": target_type,
        "target_scope": scope,
        "target_shape": shape,
        "target_restrict": restrict,
        # Radius is only meaningful for the scopes that cover an area - a group buff carries one
        # too (the range within which group members get it), but a single-target spell's is noise.
        "aoe_radius": (aoe_radius or None) if scope in ("aoe", "group") else None,
        "max_targets": (client_spell.get("max_targets") or None) if scope == "aoe" else None,
        "range": client_spell.get("range") or None,
    }


RESIST_TYPES = {
    0: None, 1: "Magic", 2: "Fire", 3: "Cold", 4: "Poison", 5: "Disease",
    6: "Chromatic", 7: "Prismatic", 8: "Physical", 9: "Corruption",
}

# A handful of common SPA names humanized for display; anything else falls back to inserting
# spaces before capitals (e.g. "MovementSpeed" -> "Movement Speed").
FRIENDLY_SPA_NAMES = {
    "CurrentHP": "HP", "CurrentHPOnce": "HP", "BardAEDot": "HP", "ArmorClass": "AC",
    "CurrentMana": "Mana", "AttackSpeed": "Haste", "ATK": "ATK",
    "ResistFire": "Fire Resist", "ResistCold": "Cold Resist", "ResistPoison": "Poison Resist",
    "ResistDisease": "Disease Resist", "ResistMagic": "Magic Resist", "Mez": "Mez",
}


def humanize_spa(name: str) -> str:
    if name in FRIENDLY_SPA_NAMES:
        return FRIENDLY_SPA_NAMES[name]
    out = []
    for i, ch in enumerate(name):
        if ch.isupper() and i > 0 and not name[i - 1].isupper():
            out.append(" ")
        out.append(ch)
    return "".join(out)


# Bard songs additionally scale with the caster's instrument skill/mod at cast time, which
# isn't stored in the spell file (it depends on the player's gear) - so these are computed at
# zero instrument bonus and flagged "approximate": true rather than silently guessed. A real
# floor, expect it to read low compared to an actual played song.
INSTRUMENT_SCALED_SPAS = {179, 270, 334}  # AllInstrumentMod, BardSongRange, BardAEDot

# --- Classification, purely from SPA effect data (no wiki `kind` tag used) -----------------

CHARM, FEAR, MEZ, ROOT = 22, 23, 31, 99
HEAL_DAMAGE, HEAL_DAMAGE_ONCE, BARD_AE_DOT, HEAL_OVER_TIME = 0, 79, 334, 100
# SPAs that tick every buff pulse (recurring HoT/DoT) vs. apply once even inside a buff.
HP_SPAS_RECURRING = {HEAL_DAMAGE, BARD_AE_DOT, HEAL_OVER_TIME}
HP_SPAS_ONCE = {HEAL_DAMAGE_ONCE}
ATTACK_SPEED = 11
MOVEMENT_SPEED = 3
COUNTER_SPAS = {35, 36, 116}  # Disease / Poison / Curse
SUMMON_SPAS = {32, 33, 71, 103, 106, 109}
TRAVEL_SPAS = {25, 26, 56, 82, 83, 104, 105, 145}
STAT_SPAS = {1, 2, 4, 5, 6, 7, 8, 9, 10, 15, 40, 46, 47, 48, 49, 50, 55, 59, 69, 78, 161, 162, 178}
UTILITY_SPAS = {12, 13, 14, 57, 58, 61, 65, 66, 67, 73, 74, 77, 91}
LIFETAP_NAME_HINTS = ("tap", "leech", "drain", "siphon")

# Effect slots worth *displaying/scoring* as a magnitude. Many other SPAs are real and useful
# for classification (their presence alone tells us the spell is a Charm/Root/Summon/etc.) but
# store something other than a player-facing number in base1 - an item id, pet template id,
# linked spell id to cast on proc/fade, an internal stacking-group tag, and so on. Verified
# case: "Efflorescing Heal"'s CastOnFadeEffect slot stores spell id 74082 in base1, which
# would otherwise show up as "+74082 Cast On Fade Effect" next to the real heal amount.
# Classification (classify_spell) runs on the *full* unfiltered effect list; this allowlist
# only controls what ends up in the row's displayed `effects`/description/primary_stat.
MAGNITUDE_DISPLAY_SPAS = {HEAL_DAMAGE, HEAL_DAMAGE_ONCE, BARD_AE_DOT, HEAL_OVER_TIME,
                           ATTACK_SPEED, MOVEMENT_SPEED} | STAT_SPAS


def classify_single_effect(spa: int, value, duration_seconds, beneficial: bool, name: str):
    """Returns a category if this one effect slot's SPA gives a confident signal, else None
    (meaning: look at the next slot). Order within a spell matters here - the client lists a
    spell's effects with the primary one first and secondary/side-effects after (e.g. a
    Cleric AC/HP combo buff's slot order is [ArmorClass, TotalHP, CurrentHPOnce] - the
    CurrentHPOnce kicker is real but shouldn't make the whole spell "Heal-Instant"). Only
    called for spells with no CC-tier effect (see classify_spell) - CC identity is decided
    separately, independent of slot order.

    A value of exactly 0 isn't a usable sign signal (Disempower's client data has CHA in
    slot 1 at value 0 - likely a scaling formula that hasn't kicked in at this class's cast
    level, or an unused padding slot - ahead of STA -11/STR -15/AC -24; treating 0 as
    "non-negative" misclassified the whole spell "Buff" instead of "Debuff"), so those slots
    return None too and classify_spell moves on to the next one."""
    if spa in SUMMON_SPAS:
        return "Pet/Summon"
    if spa in TRAVEL_SPAS:
        return "Travel"
    if spa in UTILITY_SPAS:
        return "Utility"
    if value == 0:
        return None
    if spa in (HEAL_DAMAGE, HEAL_DAMAGE_ONCE, BARD_AE_DOT, HEAL_OVER_TIME):
        recurring = bool(duration_seconds) and spa in HP_SPAS_RECURRING
        if value < 0:
            if beneficial is False and any(h in name.lower() for h in LIFETAP_NAME_HINTS):
                return "Lifetap"
            return "DoT" if recurring else "Nuke"
        return "Heal-HoT" if recurring else "Heal-Instant"
    if spa in COUNTER_SPAS:
        return "Cure" if value < 0 else "DoT"
    if spa == MOVEMENT_SPEED:
        return "Slow" if value < 0 else "Buff"
    if spa == ATTACK_SPEED:
        return "Slow" if value < 0 else "Buff"
    if spa in STAT_SPAS:
        return "Debuff" if value < 0 else "Buff"
    return None


def classify_spell(name: str, effects: list, duration_seconds, beneficial: bool) -> str:
    # Crowd control is the spell's headline mechanic whenever present, regardless of which
    # slot it's in - unlike the Buff-vs-heal-kicker ambiguity below, a Fear/Root/Mez/Snare
    # spell with an incidental secondary debuff is still fundamentally that CC tool (this is
    # what the app's Grouping Loadout actually needs to find, per docs/PROJECT_GOALS.md).
    spa_set = {e["spa"] for e in effects}
    if CHARM in spa_set:
        return "Charm"
    if FEAR in spa_set:
        return "Fear"
    if MEZ in spa_set:
        return "Mesmerize"
    if ROOT in spa_set:
        return "Root"
    # A slow is deliberately NOT in this "presence is identity" block: unlike Charm/Fear/Mez/Root,
    # a haste/movement debuff is routinely a side-effect rather than the point. The Torpor line
    # (Stoicism, Nonchalance) is a heal-over-time that costs the target attack speed; the
    # Necromancer's Clinging Darkness line is a DoT that happens to snare. Those are the slot-order
    # ambiguity the loop below already resolves, so ATTACK_SPEED/MOVEMENT_SPEED are classified
    # there - a spell is a Slow when slowing is its *first* real effect, not merely one of them.

    for e in effects:
        category = classify_single_effect(e["spa"], e["value"], duration_seconds, beneficial, name)
        if category is not None:
            return category
    if beneficial is True:
        return "Buff"
    if beneficial is False:
        return "Debuff"
    return "Other"


# --- "What the game would show": per-effect phrasing -----------------------------------

# Two descriptions ride along on each spell, serving different UI needs:
#   * `description` (built here) is a compact, generated effect list ("Increase AC by 5<br>...")
#     synthesized from the SPA effects, same approach as the reference eqspellparser project's
#     SpellData.cs. A pragmatic subset of its hundreds-of-SPA switch, sized to this classic-era
#     dataset; anything not covered falls back to the "+value Stat" phrasing.
#   * `description_text` (from extract_client_spells.py, %z/count tokens finished in
#     parse_effects.py) is the game's own hand-authored prose from dbstr_us.txt type 6, keyed by
#     each spell's description_index. An earlier version of this comment claimed that text didn't
#     exist for memorized spells ("zero matches ... only AA/passive abilities") - that was wrong:
#     every spell in this client has a real description there, which is what the UI tooltip shows.
def _pct(value):
    return f"{abs(value)}%"


SIGNED_PHRASES = {
    HEAL_DAMAGE: ("Increase Current HP by {v}", "Decrease Current HP by {v}"),
    HEAL_DAMAGE_ONCE: ("Increase Current HP by {v}", "Decrease Current HP by {v}"),
    BARD_AE_DOT: ("Increase Current HP by {v}", "Decrease Current HP by {v}"),
    HEAL_OVER_TIME: ("Increase Current HP by {v}", "Decrease Current HP by {v}"),
    1: ("Increase AC by {v}", "Decrease AC by {v}"),
    2: ("Increase ATK by {v}", "Decrease ATK by {v}"),
    4: ("Increase STR by {v}", "Decrease STR by {v}"),
    5: ("Increase DEX by {v}", "Decrease DEX by {v}"),
    6: ("Increase AGI by {v}", "Decrease AGI by {v}"),
    7: ("Increase STA by {v}", "Decrease STA by {v}"),
    8: ("Increase INT by {v}", "Decrease INT by {v}"),
    9: ("Increase WIS by {v}", "Decrease WIS by {v}"),
    10: ("Increase CHA by {v}", "Decrease CHA by {v}"),
    15: ("Increase Current Mana by {v}", "Decrease Current Mana by {v}"),
    40: ("Grant Divine Aura ({v} hit(s))", "Grant Divine Aura ({v} hit(s))"),
    46: ("Increase Fire Resist by {v}", "Decrease Fire Resist by {v}"),
    47: ("Increase Cold Resist by {v}", "Decrease Cold Resist by {v}"),
    48: ("Increase Poison Resist by {v}", "Decrease Poison Resist by {v}"),
    49: ("Increase Disease Resist by {v}", "Decrease Disease Resist by {v}"),
    50: ("Increase Magic Resist by {v}", "Decrease Magic Resist by {v}"),
    55: ("Absorb {v} Damage (Rune)", "Absorb {v} Damage (Rune)"),
    59: ("Increase Damage Shield by {v}", "Decrease Damage Shield by {v}"),
    69: ("Increase Max HP by {v}", "Decrease Max HP by {v}"),
    78: ("Absorb {v} Spell Damage (Rune)", "Absorb {v} Spell Damage (Rune)"),
    161: ("Absorb {v}% of Incoming Spell Damage", "Absorb {v}% of Incoming Spell Damage"),
    162: ("Absorb {v}% of Incoming Melee Damage", "Absorb {v}% of Incoming Melee Damage"),
    178: ("Increase Melee Lifetap by {v}", "Increase Melee Lifetap by {v}"),
    35: ("Increase Disease Counter by {v}", "Cure {v} Disease Counter(s)"),
    36: ("Increase Poison Counter by {v}", "Cure {v} Poison Counter(s)"),
    116: ("Increase Curse Counter by {v}", "Cure {v} Curse Counter(s)"),
}

FIXED_PHRASES = {
    22: "Charm",
    23: "Fear",
    31: "Mesmerize",
    99: "Root",
    25: "Set Bind Point",
    26: "Gate to Bind Point",
    56: "Set Group Reference Point",
    82: "Teleport Caster",
    83: "Teleport Caster",
    104: "Translocate Caster",
    105: "Teleport (Anchor)",
    145: "Teleport (Anchor)",
    32: "Summon Item",
    33: "Summon Pet",
    71: "Summon Pet",
    103: "Summon Companion",
    106: "Summon Pet",
    57: "Levitate",
    58: "Illusion: Change Form",
    61: "Identify Item",
    74: "Feign Death",
    77: "Locate Corpse",
    12: "Invisibility",
    13: "See Invisible",
    14: "Enduring Breath",
    65: "Infravision",
    66: "Ultravision",
    67: "Eye of Zomm",
    73: "Bind Sight",
    91: "Summon Corpse",
    18: "Reduce Aggro Radius (Lull)",
    30: "Reduce Aggro Radius",
    86: "Harmony (Reduce Hate)",
    27: "Dispel Magic",
    21: "Stun",
    20: "Blind",
    88: "Evacuate Group",
    81: "Resurrect Target",
    85: "Chance to Proc a Spell on Hit",
    42: "Shadow Step",
    28: "Invisibility versus Undead",
    29: "Invisibility versus Animals",
    52: "Sense the Dead",
    53: "Sense Summoned",
    54: "Sense Animals",
    63: "Wipe Hate List (Memblur)",
    298: "Change Height",
    89: "Change Model Size",
}


def render_effect_phrase(effect: dict):
    """Returns a phrase, or None if this SPA has no known-safe phrasing (see render_description
    for why unmapped SPAs are dropped rather than shown with a raw fallback)."""
    spa, value = effect["spa"], effect["value"]
    if spa == 3:  # MovementSpeed
        return f"Increase Movement Speed by {_pct(value)}" if value >= 0 else f"Decrease Movement Speed by {_pct(value)}"
    if spa == 11:  # AttackSpeed - already normalized to a signed bonus in build_row
        return f"Increase Melee Haste by {_pct(value)}" if value >= 0 else f"Decrease Melee Haste by {_pct(value)}"
    if spa in SIGNED_PHRASES:
        up, down = SIGNED_PHRASES[spa]
        return (up if value >= 0 else down).format(v=abs(value))
    if spa in FIXED_PHRASES:
        return FIXED_PHRASES[spa]
    return None


def render_description(effects: list, category: str) -> str:
    # Zero-value slots (unused/not-yet-scaled-in effects, e.g. Feral Spirit's 3 padding CHA
    # slots) are real client data but meaningless to show next to the spell's actual effects.
    #
    # Only SPAs with a known-safe phrase template (render_effect_phrase) are shown at all -
    # NOT every nonzero effect. Some SPAs store something other than a player-facing magnitude
    # in `value` (an internal spell id to cast on proc/fade, a stacking-group tag, ...); the
    # generic "+value Stat" fallback this used to have was already proven wrong for those (see
    # build_row's MAGNITUDE_DISPLAY_SPAS note - "Efflorescing Heal"'s CastOnFadeEffect slot
    # stores spell id 74082 in base1) and would silently reappear here by showing "+74082 Cast
    # On Fade Effect" if that same fallback were reused for descriptions. An incomplete
    # description (an effect quietly omitted because we don't have a phrase for it yet) is
    # honest; a fabricated-looking number is not - so unmapped SPAs are dropped, not guessed.
    nonzero = [e for e in effects if e["value"] != 0]
    phrases = [p for p in (render_effect_phrase(e) for e in nonzero) if p is not None]
    if not phrases:
        return ""
    suffix = " (per tick)" if category in ("Heal-HoT", "DoT") else ""
    return "<br>".join(f"{p}{suffix}" for p in phrases)


# --- Matching a wiki (class, level, name) row to the best client spell record --------------

def pick_candidate(candidates: list, class_code: str, wiki_level: int):
    scored = [(c["classes"][class_code], c) for c in candidates if class_code in c["classes"]]
    if not scored:
        return None
    non_sentinel = [pair for pair in scored if pair[0] not in SENTINEL_LEVELS]
    pool = non_sentinel or scored
    pool.sort(key=lambda pair: abs(pair[0] - wiki_level))
    return pool[0]


def build_row(wiki_row: dict, class_code: str, caster_level: int, client_spell: dict, spa_names: dict) -> dict:
    ticks = calc_duration_ticks(caster_level, client_spell["duration_base"], client_spell["duration_cap"])
    duration_seconds = None if ticks in (DURATION_PERMANENT, DURATION_PERMANENT_AURA) else ticks * 6

    effects = []
    for slot in client_spell["effects"]:
        spa_name = spa_names.get(str(slot["spa"]), f"SPA{slot['spa']}")
        approximate = slot["spa"] in INSTRUMENT_SCALED_SPAS
        value = (slot["base1"] if approximate
                 else calc_effect_value(slot["calc"], slot["base1"], slot["max"], caster_level))
        # AttackSpeed is stored as a percentage OF NORMAL, not a bonus: 160 is +60% haste and
        # 30 is a 70% slow. Left raw, "bigger is better" ranking reads every slow backwards
        # (Drowsy 75 beating Togor's Insects 30) and the sign tests below - which is what makes
        # a slow classify as "Slow" instead of "Buff" - never fire, since 30 isn't negative.
        # Normalize once, here, so every consumer sees a signed bonus like every other stat.
        if slot["spa"] == ATTACK_SPEED:
            value -= 100
        effects.append({"spa": slot["spa"], "spa_name": spa_name, "stat": humanize_spa(spa_name),
                         "value": value, "approximate": approximate})

    # Classify on the full effect list (CC/summon/travel spells are identified by an SPA's
    # presence, not a displayable magnitude) but only display/score genuine stat magnitudes.
    category = classify_spell(wiki_row["name"], effects, duration_seconds, client_spell["beneficial"])
    # Zero-value slots are real client data (see classify_single_effect's docstring) but not
    # a displayable/scorable magnitude - drop them here too so every downstream consumer of
    # the `effects` field (UI, rank_spells.py) sees only real numbers.
    display_effects = [e for e in effects if e["spa"] in MAGNITUDE_DISPLAY_SPAS and e["value"] != 0]

    # The client's own spell-line taxonomy (fields 86/87 -> dbstr type 5; see
    # extract_client_spells.py). `line` is the display label; `line_id` is the stable key that
    # build_buff_stacking.py groups cross-class buff lines on. subcategory alone is the finest
    # grain (e.g. "HP type one"); prefix with the category so identically-named subcategories
    # under different parents can't collide.
    line_category = client_spell.get("line_category")
    line_subcategory = client_spell.get("line_subcategory")
    if line_subcategory:
        line_label = f"{line_category} › {line_subcategory}" if line_category else line_subcategory
        line_id = f"{line_category or ''}:{line_subcategory}"
    else:
        line_label = line_category
        line_id = f"{line_category}:" if line_category else None

    return {
        "class": wiki_row["class"],
        "level": caster_level,
        "name": wiki_row["name"],
        "spell_id": client_spell["id"],
        "line_category": line_category,
        "line_subcategory": line_subcategory,
        "line": line_label,
        "line_id": line_id,
        "spell_group": client_spell.get("spell_group"),
        "mana": client_spell["mana"],
        "cast_time_s": client_spell["cast_time_ms"] / 1000,
        "recast_time_s": client_spell["recast_ms"] / 1000,
        "duration_seconds": duration_seconds,
        # The raw client label, kept verbatim so an unmapped target type stays visible ("Type 56")
        # rather than silently becoming whatever derive_target inferred for it.
        "target": TARGET_TYPES.get(client_spell["target_type"], f"Type {client_spell['target_type']}"),
        # target_type / target_scope / target_shape / target_restrict / aoe_radius / max_targets /
        # range - see derive_target. `target_scope` is the one the comparison views partition on.
        **derive_target(client_spell),
        "resist_type": RESIST_TYPES.get(client_spell["resist_type"]),
        "beneficial": client_spell["beneficial"],
        "category": category,
        "effects": display_effects,
        # Full SPA footprint (every effect slot, including non-magnitude ones like Lull's
        # pacify trio or a weapon-proc slot). The UI's buff-template engine needs *presence*
        # of these to recognize what a spell actually does (utility vs real buff), even when
        # there's no displayable number for them.
        "spas": sorted({e["spa"] for e in effects}),
        "description": render_description(effects, category),
        # The client's own prose description (dbstr type 6). Slot values (#N/@N/$N) are already
        # resolved; the duration token (%z) and rarer count tokens are finished in parse_effects.py,
        # which has the computed duration string.
        "description_text": client_spell.get("description_text", ""),
    }


def main():
    wiki = json.loads((DATA_DIR / "spells_wiki_index.json").read_text(encoding="utf-8"))
    client = json.loads((DATA_DIR / "spells_client_raw.json").read_text(encoding="utf-8"))
    spa_names = json.loads((DATA_DIR / "spa_effects.json").read_text(encoding="utf-8"))

    by_name = {}
    for s in client:
        if s["classes"]:
            by_name.setdefault(s["name"].strip().lower(), []).append(s)

    rows = []
    unmatched = []
    approximate_count = 0
    for wiki_row in wiki:
        class_code = CLASS_NAME_TO_CODE.get(wiki_row["class"])
        candidates = by_name.get(wiki_row["name"].strip().lower(), [])
        picked = pick_candidate(candidates, class_code, wiki_row["level"]) if class_code else None
        if not picked:
            unmatched.append(f"{wiki_row['class']}: {wiki_row['name']}")
            continue
        caster_level, client_spell = picked
        row = build_row(wiki_row, class_code, caster_level, client_spell, spa_names)
        approximate_count += sum(1 for e in row["effects"] if e["approximate"])
        rows.append(row)

    rows.sort(key=lambda r: (r["class"], r["level"], r["name"]))
    (DATA_DIR / "spells_raw.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")

    print(f"Matched {len(rows)}/{len(wiki)} wiki-indexed spells to client data -> data/spells_raw.json")
    print(f"{approximate_count} effect slots are instrument-scaled (Bard) and shown at base value only")
    if unmatched:
        print(f"{len(unmatched)} wiki entries had no client match and were dropped:")
        for u in unmatched:
            print(f"  {u}")
    print("Category breakdown:")
    cat_counts = Counter(r["category"] for r in rows)
    for cat, n in cat_counts.most_common():
        print(f"  {cat}: {n}")


if __name__ == "__main__":
    main()
