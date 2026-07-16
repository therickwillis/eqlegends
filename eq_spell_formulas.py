"""Python port of the EQ spell-value formulas used by the client/server, needed to turn the
raw scaling coefficients in spells_us.txt into the actual numbers a character sees in-game.

Ported from EQEmu/Server (https://github.com/EQEmu/Server), whose implementation matches this
game's client format (see extract_client_spells.py docstring). Sources:
  - CalcBuffDuration_formula in zone/spells.cpp
  - CalcSpellEffectValue_formula in zone/spell_effects.cpp

Verified against known values: Superior Healing (base1=200, calc=10, max=600) at caster level 30
computes to 200 + 30*10 = 500, matching eqlwiki.com's independently-sourced "500-600 HP".
"""

# Sentinel return values from CalcBuffDuration_formula meaning "not a fixed number of ticks".
DURATION_PERMANENT = -1  # cancelled by casting/combat/curing, not by time
DURATION_PERMANENT_AURA = -4  # cancelled only when out of aura range


def calc_duration_ticks(caster_level: int, formula: int, duration_cap: int) -> int:
    """Returns ticks (6s each), or one of the DURATION_PERMANENT* sentinels."""
    if formula == 1:
        temp = caster_level // 2 if caster_level > 3 else 1
    elif formula == 2:
        temp = caster_level // 2 + 5 if caster_level > 3 else 6
    elif formula == 3:
        temp = 30 * caster_level
    elif formula == 4:
        temp = 50
    elif formula == 5:
        temp = 2
    elif formula == 6:
        temp = caster_level // 2 + 2
    elif formula == 7:
        temp = caster_level
    elif formula == 8:
        temp = caster_level + 10
    elif formula == 9:
        temp = 2 * caster_level + 10
    elif formula == 10:
        temp = 3 * caster_level + 10
    elif formula == 11:
        temp = 30 * (caster_level + 3)
    elif formula == 12:
        temp = caster_level // 4 if caster_level > 7 else 1
    elif formula == 13:
        temp = 4 * caster_level + 10
    elif formula == 14:
        temp = 5 * (caster_level + 2)
    elif formula == 15:
        temp = 10 * (caster_level + 10)
    elif formula == 50:
        return DURATION_PERMANENT
    elif formula == 51:
        return DURATION_PERMANENT_AURA
    else:
        if formula < 200:
            return 0
        temp = formula

    if duration_cap and duration_cap < temp:
        temp = duration_cap
    return temp


def calc_effect_value(formula: int, base_value: int, max_value: int, caster_level: int) -> int:
    """Scales a raw spells_us.txt effect (base1/calc/max) to the value at a given caster level."""
    ubase = abs(base_value)
    updown = -1 if (max_value < base_value and max_value != 0) else 1

    if formula in (60, 70):
        result = ubase // 100
    elif formula in (0, 100):
        result = ubase
    elif formula == 101:
        result = updown * (ubase + caster_level // 2)
    elif formula == 102:
        result = updown * (ubase + caster_level)
    elif formula == 103:
        result = updown * (ubase + caster_level * 2)
    elif formula == 104:
        result = updown * (ubase + caster_level * 3)
    elif formula == 105:
        result = updown * (ubase + caster_level * 4)
    elif formula == 109:
        result = updown * (ubase + caster_level // 4)
    elif formula == 110:
        result = ubase + caster_level // 6
    elif formula == 111:
        result = updown * (ubase + 6 * (caster_level - 16))
    elif formula == 112:
        result = updown * (ubase + 8 * (caster_level - 24))
    elif formula == 113:
        result = updown * (ubase + 10 * (caster_level - 34))
    elif formula == 114:
        result = updown * (ubase + 15 * (caster_level - 44))
    elif formula == 115:
        result = ubase + (7 * (caster_level - 15) if caster_level > 15 else 0)
    elif formula == 116:
        result = ubase + (10 * (caster_level - 24) if caster_level > 24 else 0)
    elif formula == 117:
        result = ubase + (13 * (caster_level - 34) if caster_level > 34 else 0)
    elif formula == 118:
        result = ubase + (20 * (caster_level - 44) if caster_level > 44 else 0)
    elif formula == 119:
        result = ubase + caster_level // 8
    elif formula == 121:
        result = ubase + caster_level // 3
    elif formula == 124:
        result = ubase + (updown * (caster_level - 50) if caster_level > 50 else 0)
    elif formula == 125:
        result = ubase + (updown * 2 * (caster_level - 50) if caster_level > 50 else 0)
    elif formula == 126:
        result = ubase + (updown * 3 * (caster_level - 50) if caster_level > 50 else 0)
    elif formula == 127:
        result = ubase + (updown * 4 * (caster_level - 50) if caster_level > 50 else 0)
    elif formula == 128:
        result = ubase + (updown * 5 * (caster_level - 50) if caster_level > 50 else 0)
    elif formula == 129:
        result = ubase + (updown * 10 * (caster_level - 50) if caster_level > 50 else 0)
    elif formula == 130:
        result = ubase + (updown * 15 * (caster_level - 50) if caster_level > 50 else 0)
    elif formula == 131:
        result = ubase + (updown * 20 * (caster_level - 50) if caster_level > 50 else 0)
    elif formula == 132:
        result = ubase + (updown * 25 * (caster_level - 50) if caster_level > 50 else 0)
    elif formula == 139:
        result = ubase + ((caster_level - 30) // 2 if caster_level > 30 else 0)
    elif formula == 140:
        result = ubase + (caster_level - 30 if caster_level > 30 else 0)
    elif formula == 141:
        result = ubase + ((3 * caster_level - 90) // 2 if caster_level > 30 else 0)
    elif formula == 142:
        result = ubase + (2 * caster_level - 60 if caster_level > 30 else 0)
    elif formula == 143:
        result = ubase + (3 * caster_level // 4)
    elif formula == 144:
        result = ubase + caster_level * 10 + (caster_level - 40) * 20
    elif formula in (201, 203):
        result = max_value
    elif formula == 123:
        # random(ubase, |max|) at cast time - no single "the" value; report the base.
        result = ubase
    elif 1000 < formula < 1999:
        # degenerating (tick-based) effects - full base value at cast, decays over the buff's life.
        result = updown * ubase
    elif 2000 <= formula <= 2650:
        result = ubase * (caster_level * (formula - 2000) + 1)
    elif formula < 100:
        # generic 1-99: base + level * formulaID
        result = ubase + caster_level * formula
    else:
        result = ubase

    if max_value != 0:
        if updown == 1:
            result = min(result, max_value)
        else:
            result = max(result, max_value)

    if base_value < 0 and result > 0:
        result = -result

    return result
