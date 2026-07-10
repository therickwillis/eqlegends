# EQ Legends — Game Notes

What we've learned about the game itself, as background for the data/tooling in this repo. Update this
as we learn more (the game hadn't launched yet as of this writing).

## Overview

- **EverQuest Legends (EQL)**: an officially licensed, standalone reimagining of classic EverQuest.
  Launching **2026-07-28**.
- Solo/casual-friendly, with optional group (4) and raid (8) content.
- Pre-Kunark content: Antonica, Faydwer, Odus. Original art style, zones, spell effects, music preserved.
- Site: https://www.everquestlegends.com — no public spell database/API as of this writing
  (eqlegendsdb.com's spell database explicitly says "coming soon").

## Multiclassing

- Pick up to **3 of 16 classes** at once — 560 possible three-class combinations.
- All 3 active classes' spells/abilities are usable simultaneously (not just passive bonuses).
- Leveling: levels 1-10, *all 16 classes* gain XP together regardless of your active loadout. At level
  10 you lock in your 3rd class. After level 10, only your active classes gain XP, but each gets the
  *full* kill XP (not split) — so a character's 3 active classes can end up at different levels from each
  other over time.
- **Quick Buff** is an AA (Alternate Advancement) skill that casts a batch of your currently-memorized
  buff spells in sequence — it is *not* a separate buff bar/pool. Buffs you want to Quick Buff still have
  to occupy regular memorize slots.
- Total memorize-slot count (shared across all 3 active classes) is more than classic EQ's fixed 8, but
  the exact number wasn't confirmed pre-launch — the tool treats this as a user-adjustable input rather
  than a hardcoded assumption.

## Classes (16 total, 4 archetypes)

| Archetype | Classes |
|---|---|
| Casters | Enchanter, Magician, Necromancer, Wizard |
| Priests | Cleric, Druid, Shaman |
| Melee (no spells) | Berserker, Monk, Rogue, Warrior |
| Hybrids | Bard, Beastlord, Paladin, Ranger, Shadow Knight |

Source: https://eqlwiki.com/Character_Classes

## Buff stacking (the mechanic that matters most for the tool)

Classic EQ assigns each buff *effect* to a numbered internal "slot" per stat (e.g. AC has slots 1-9,
plus a separate "Layer 2" set; HP has a couple of slots; each of the 7 attributes has its own slots;
resists, haste, damage shield, damage absorb, and regen each have their own slot sets too). Two buffs
that occupy the *same* slot **do not stack** — only the stronger one actually applies, even if you have
both active. A single "combo" buff (e.g. Cleric's Courage: +AC, +Max HP, +HP-on-cast) occupies more than
one slot at once.

This is exactly the mechanic behind "a Cleric HP buff and a Druid HP buff don't stack" — they're
different spells, different classes, even different stat-text, but the same underlying slot.
eqlwiki.com's **Buff Lines** page (https://eqlwiki.com/Buff_Lines) hand-curates this cross-class, listing
every known spell/item under the slot it occupies. It's classic-EQ-sourced content and not 100% complete
for EQL specifically — see `docs/PROJECT_GOALS.md` for how the tool handles gaps.

## Data source

- **eqlwiki.com** — a MediaWiki install, the primary source for this project.
  - Class pages (e.g. `/Cleric`) have per-level spell tables built from a `{{RadSpellRow2}}` template
    (name, kind, target, mana, duration, max effect, description, school, location, era).
  - Each spell also has its own individual page (e.g. `/Courage`) via a `{{Spellpage}}` template, which
    carries an icon code (`spellicon_<code>.png`) and sometimes a `Category:X line` tag (inconsistently
    applied — not reliable alone for stacking data).
  - `/Buff_Lines` hand-curates cross-class buff stacking slots (see above).
  - All fetched via the standard MediaWiki API (`api.php?action=query&prop=revisions...`), no auth needed.
