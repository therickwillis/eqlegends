# Project Goals

## The problem

EQ Legends' multiclass system means a character has up to 3 classes' worth of spells available at once,
across 560 possible combinations. Several classes offer similar-effect spells (heals, HoTs, AC/HP buffs,
crowd control, etc.), but it's not obvious from the wiki's per-class pages which class's version is
actually better to use, or whether two classes' versions even work together — see
`docs/GAME_NOTES.md`'s buff-stacking section for why that second question is a real mechanic, not a
guess.

**Goal:** turn the wiki's raw spell data into something that answers, for a given 3-class combo and
level: *what should I actually memorize?* — both for buffing (Quick Buff) and for general
grouping/combat play.

## Current state

Data pipeline (each step re-runnable independently, in order):

1. `scrape.py` — pulls per-level spell tables for all 16 classes → `data/spells_raw.json`
2. `fetch_icons.py` — resolves + downloads each spell's icon → `app/icons/`, `data/spell_icons.json`
3. `buff_stacking.py` — parses the Buff Lines wiki page into a spell → stacking-slot map →
   `data/buff_stacking.json`
4. `parse_effects.py` — parses effect magnitudes, classifies into categories, attaches icons and
   stacking data → `data/spells.json` (+ `app/data.js` for the no-build-step UI)

UI (`app/index.html`, opened directly as a `file://` page, no server) has three tabs:

- **Loadouts** — a Buff Loadout (real stacking-slot data, greedy set-cover so combo buffs correctly
  claim multiple slots) and a role-based Grouping Loadout (Healer/Damage/Crowd Control/Debuffer/
  Utility-Support), both against a user-set memorize-slot budget.
- **Category Grid** — every category's best spell per selected class, at a glance, with the strongest
  cell per row highlighted.
- **Full Comparison** — the original detailed side-by-side view (all categories, both classes' full
  stats shown).

Class/level/slots/roles/active-tab selections persist through the URL querystring.

## Design decisions worth remembering (the "why")

- **Buffs are mutually exclusive by real stacking slot, not by text heuristics.** Early versions grouped
  buffs by parsed primary-stat text, which both over- and under-merged. Now sourced from eqlwiki.com's
  Buff Lines page. Spells not found there (~25-40% of Buff-category spells — mostly because they're
  genuinely undocumented, or because non-buff utility spells like Levitate/Camouflage were originally
  miscategorized as "Buff" and have since been reclassified to Utility) are still shown, flagged
  "unconfirmed" rather than silently dropped or wrongly assumed to conflict.
- **Heals/nukes/CC are *not* mutually exclusive across classes.** Unlike buffs, there's no game mechanic
  stopping you from memorizing both a Cleric heal and a Druid heal — so the Grouping Loadout shows one
  pick *per class per category*, only collapsing same-class redundant tiers (e.g. Druid's Light Healing
  vs. Superior Healing). Fear/Root/Slow are each their own category (not collapsed into one generic
  "Debuff" bucket) since they're different crowd-control tools you'd want separate picks for.
- **Memorize slot count is a user input, not hardcoded** — the real number wasn't confirmed pre-launch.
- **Level is currently one shared value for the whole 3-class combo**, even though classes actually level
  independently after character level 10 (see GAME_NOTES.md). Simplification, not a data limitation —
  revisit if per-class level input turns out to matter in practice.
- Ranking "best" spell in a category is a single scalar magnitude heuristic (`spellPower` in
  `app/compare.js`), which handles same-stat comparisons well (350 HP vs 600 HP) but is rougher across
  incommensurable stat types within one category (e.g. ranking a +40 ATK buff against a +40 Poison Resist
  buff in the Category Grid's "best" highlight). Damage-ish categories (Nuke/DoT/Debuff) store effect
  values as negative numbers, so ranking compares by magnitude (`Math.abs`), not raw signed value.

## Known gaps / open items

- Buff stacking-group coverage isn't 100% (see above) — re-run `buff_stacking.py` periodically; the wiki
  may fill in gaps as EQL approaches/passes launch.
- No per-class independent level input yet.
- Some auto-generated stacking-group labels are terse (e.g. just "Primary") since the parser doesn't
  always capture full table-header context from the wiki page.
- Game launches 2026-07-28 — re-run the full pipeline periodically pre/post-launch as the community wiki
  matures and any EQL-specific spell balance changes get documented.
