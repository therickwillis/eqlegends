# Project Goals

## The problem

EQ Legends' multiclass system means a character has up to 3 classes' worth of spells available at once,
across 560 possible combinations. Several classes offer similar-effect spells (heals, HoTs, AC/HP buffs,
crowd control, etc.), but it's not obvious which class's version is actually better to use, or whether
two classes' versions even work together — see `docs/GAME_NOTES.md`'s buff-stacking section for why that
second question is a real mechanic, not a guess.

**Goal:** turn the game's raw spell data into something that answers, for a given 3-class combo and
level: *what should I actually memorize?* — both for buffing (Quick Buff) and for general
grouping/combat play.

## Current state

**The game client is the source of truth for all numbers.** The local EQ Legends install
(`F:\EverquestLegends`) ships `spells_us.txt` — the classic EQ-engine spell database (~74k rows,
^-delimited, effect slots encoded as `SLOT|SPA|BASE1|BASE2|CALC|MAX`). Field offsets and the
level-scaling/duration formulas were ported from the EQEmu open-source server project and verified
against independently-known spell values. The wiki (eqlwiki.com) is used **only as an index** of which
spells/classes/levels exist in EQ Legends' ruleset — that curation is server-side policy not present in
any client file — plus icons. Every number, effect, category, and description is client-derived.

Data pipeline — run `python update_pipeline.py` after a game update (client-only by default; `--full`
also refreshes the wiki index/icons):

1. `extract_client_spells.py` — parses the client's `spells_us.txt` → `data/spells_client_raw.json`
   (gitignored, ~70MB)
2. `scrape.py` — wiki spell index (names/classes/levels only) → `data/spells_wiki_index.json` [network]
3. `build_spells_raw.py` — matches index → client records; computes real effect magnitudes at cast level
   via `eq_spell_formulas.py`; classifies by SPA effect id; generates in-game-style descriptions →
   `data/spells_raw.json`
4. `fetch_icons.py` — spell icons from the wiki → `app/icons/`, `data/spell_icons.json` [network]
5. `build_buff_stacking.py` — buff-stacking lines from the client's own spell-line taxonomy (each
   spell's Category/Subcategory; effect-signature fallback for the rare uncategorized spell) →
   `data/buff_stacking.json`
6. `parse_effects.py` — final merge, derived metrics → `data/spells.json` + `app/data.js`
7. `classify_roles.py` — data-driven per-class role-affinity analysis → `data/class_roles.json`

UI (`app/index.html`, opened directly as a `file://` page, no server) has these tabs:

- **Loadouts** — Buff Loadout (greedy set-cover over real stacking lines), against a user-set
  memorize-slot budget. (A role-based "Grouping Loadout" and its Grouping Roles checkbox row lived
  here too; both were cut as noise — the play-style archetypes they used survive as the Rank Lab's
  archetype selector.)
- **Buff Template** — the flagship recommendation view: a Quick Buff spell set scored by *recipient*
  (Self/Tank/Melee/Caster/Healer/Pets, each toggleable with an importance slider), one pick per stacking
  line with a generated "why" (top role, driving stats, rivals it beat), and an auditable
  excluded-with-reasons section (see `suggestedBuffTemplate` in `app/rank.js`).
- **Category Grid** — a best-in-slot board organized entirely by the client's own spell-line taxonomy:
  each section is a client spell Category (Direct Damage, HP Buffs, Utility Detrimental, …), each row a
  line (Subcategory) **× target scope** within it, showing the best spell your classes can field for
  that line plus the same-line spells it beats (▲ for buff lines that won't stack). Sections and lines
  both sort alpha, and a line's rows sort narrow-reach first.
  **Collection lines** — sets of equivalent variants with no "best" (Enchanter illusions: Dwarf isn't
  better than Dark Elf; `isCollectionLine`, matches Illusion/Visage subcategories) — instead list every
  spell as its own row under one shared label, rather than crowning a winner. See `spellLineGrid` in
  `app/compare.js`.
- **Full Comparison** — detailed side-by-side spell cards per category.
- **Rank Lab** — experimental weighted multi-stat ranking of any category with live per-archetype weight
  sliders; rows grouped per spell (shared spells show all classes/levels in one row).

Class/level/slots/roles/recipients/target-scopes/active-tab selections persist through the URL querystring.

## Design decisions worth remembering (the "why")

- **Client numbers over wiki numbers, wiki only as an index.** The wiki's per-spell numbers are
  hand-transcribed and pre-launch-stale; the client file is the game's own data. But the client file
  contains the entire 25-year live-EQ spell database (~34k player-castable spells), and which subset is
  "really in EQ Legends" (trainer lists, level cap) is server-side — so the wiki's curated spell list
  stays as the inclusion filter. Wiki rows with no confident client match are dropped, not guessed.
- **Classification comes from SPA effect ids, not text.** Each effect slot carries a numeric SPA id
  (0=CurrentHP, 22=Charm, 99=Root, ...; `data/spa_effects.json`, from EQEmu's spdat.h). Order matters:
  the client lists a spell's primary effect first, so a Cleric AC/HP combo buff with a one-time HP
  kicker stays "Buff", not "Heal-Instant" — but CC SPAs (Charm/Fear/Mez/Root/Slow) win from any slot,
  since CC is the headline mechanic whenever present. Zero-value slots (unused padding, e.g.
  Disempower's dead CHA slot) are ignored everywhere: classification, display, scoring, stacking.
- **Buff stacking uses the client's own spell-line taxonomy — lines are the display's organizing
  thread.** Every spell carries a Category/Subcategory (`spells_us.txt` 86/87 → `dbstr_us.txt` type 5),
  the "spell line" the game shows on hover, and its subcategory *is* the cross-class buff-line id:
  Courage (CLR) and Skin like Wood (DRU) are both `HP Buffs › HP type one` → don't stack, while Symbol
  of Ryltan (`HP Buffs › Symbol`) and the Shielding line are separate lines that stack with them. This
  is the game's own labeling, so it separates lines that share an identical effect signature but sit on
  different slots — the residual failure of the earlier effect-signature key, which grouped by the sorted
  set of persistent stat SPAs and couldn't tell `Symbol` / `HP type one` / `Shielding` apart. 100% of the
  ~500 EQL buff/long-HoT spells carry a client line; the ~27% uncategorized in the raw client file are
  legacy duplicate entries the wiki-index match already drops, so the effect-signature approach survives
  only as a fallback (currently unused). The line is surfaced on every spell in the UI (a chip on each
  card/row, the row heading in the Category Grid's buff section, the "claims" line in the Buff Template,
  a Line column in Rank Lab). Bard songs conflict only with each other (bard-only lines are namespaced);
  negative-AC effects don't claim an AC line. Long-duration Heal-HoTs (Regeneration/Chloroplast line, ≥5
  min) get lines too — they behave as template buffs.
- **Target scope partitions the board; it never re-ranks it.** Every spell carries a derived
  `target_scope` (`self`/`single`/`group`/`aoe`/`pet`, from the client's target type — see
  `derive_target` in `build_spells_raw.py`), and the best-in-slot views give each scope its own row
  within a line. The reason is that a single-target nuke and an AE nuke aren't competing for one
  memorize slot — you bring both — so ranking them against each other on raw magnitude produced
  actively wrong crowns: `Direct Damage › Magic` for a Magician crowned the AE Upheaval and buried
  the single-target nuke as a "runner-up", and `Heals › Heals` did the reverse to the group heal.
  47 of 114 lines mix scopes, so this was the rule rather than the exception.
  - **Buff lines are the exception: they partition by *body*, not headcount** (self / pet /
    anyone-else). Group Temperance and Temperance are the same client line and genuinely knock each
    other out, so splitting them into rival rows would tell you to memorize both. This is the same
    namespace rule the Buff Template already used for stacking conflicts (`nsPrefix` in `rank.js`).
  - **Reach is a tiebreak, never a ranking input.** At equal magnitude the wider spell wins (one
    cast covers the group); it can never lift a weaker spell over a stronger one. Deliberately
    conservative — the Buff Template's and Rank Lab's numbers are unchanged by target scope, so
    adding the dimension couldn't silently move an existing recommendation.
  - **"Which bodies" is a separate axis from "how many".** `target_restrict` (undead/animal/
    summoned/plant/corpse) rides alongside the scope: Expulse Undead is an ordinary single-target
    spell that happens to be useless on most mobs, which is a different fact from how wide it is.
  - **Target scope is TEXT, never color** — a Target column in the Category Grid, a suffix on the
    line label in the dense views, the Target/Reach/Radius/Max-targets rows in the spell tooltip.
    Three visual encodings were tried and rejected before landing here: a chip (put a pill inside a
    pill in the Matrix cell), a reticle glyph (illegible at 11px on busy dark rows), and a colored
    ring on the spell icon (worked, but see the next bullet — the frame belongs to something else).
    Words also retire a real problem: **the client ships no target-type palette**, so any colors
    here were invented, and an invented 5-hue set competing with the class pills and element chips
    is exactly what kept reading as noise. Words collide with nothing.
  - **The dense views only say the target when a line actually split** (`row.split` from
    `spellLineGrid`). That's the one case where two adjacent rows would otherwise look identical.
    The Board's label column is a fixed 84px; spending it on a suffix every row is what pushed real
    line names into an ellipsis.
- **The spell icon's frame is the game's own: blue = beneficial, red = detrimental.** Copied from
  EQ Legends' Actions › Spells window, hexes sampled from it (`#0060e0` / `#e00000`, drawn as an
  `outline` so it sits outside the artwork the way the game's frame does). Verified 17/17 against a
  live Enchanter spell list — including the two that would trip a guess, since **Lull** (a calm) and
  **Taper Enchantment** (a dispel) both sit under the *Utility Detrimental* category yet are flagged
  `beneficial`, and the game paints them blue. That same window lists **Gem | Name | Level | Category
  | Subcategory** — the taxonomy this whole tool is built on — so mirroring its frame costs nothing
  and buys instant familiarity for anyone with the real window open on a second monitor.
  - Worth knowing for later: this is **not** the only color system in the game. The spell *bar*
    tints its gem holder (`A_SpellGemHolder`, a greyscale mask in `window_pieces02.tga`) from a
    different, wider palette — `#d81818` / `#d830d8` / `#c0d818` observed — which tracks
    `spells_us.txt` **field 146**, a fixed 0–8 enum classifying spells as buff/cure/damage/
    debuff-CC/heal/lifetap/summon/travel. Not currently used; it's a client-authoritative
    classification we don't otherwise have, and it disagrees with our SPA classifier in places
    (the client calls Cannibalize a *heal* and Tashania a *debuff*).
  - The palette hunt that got here, so it isn't repeated: across 305 `.tga`s, 228 UI XMLs, both
    `.ini` palettes and all 70 `dbstr_us.txt` string tables, nothing keys color to *target type*.
    `uifiles/default/TargetIndicator.ini` is the closest thing and it's the **con-difficulty** ring
    (Trivial `#505064` → Deadly `#FF0000`) — red there means "this will kill you", not "one target".
- **Same-class tier collapsing can key on SpellGroup.** `spells_us.txt` field 165 (`100` + class index +
  line number) clusters the tiers of one class's line (Courage/Center/Bravery/Valor; Rk. II/III variants).
  Carried through the pipeline as `spell_group`; the loadouts currently collapse tiers by class+category,
  and this is available as a cleaner, name-independent key if that ever needs tightening.
- **Stacking conflicts only exist between buffs landing on the same body.** In the Buff Template
  engine, self-only buffs (Shielding line, skins) and pet buffs (Burnout line) compete in their own
  namespaces — your own Shielding and a Temperance cast on you coexist; Harnessing of Spirit must not
  knock out Burnout via a shared STR line.
- **Buff value depends on the recipient, not the caster.** Haste is a melee's biggest buff and worthless
  on a wizard; Clarity-line regen is the reverse. The Buff Template scores each buff per recipient role
  (concept weights in `TEMPLATE_ROLE_WEIGHTS`, `app/rank.js`) and sums across enabled recipients — one
  gem that serves the whole group (Temperance) outranks a same-size single-role buff. "Self" weights
  derive from what the selected trio can actually use. Junk is hard-excluded with auditable reasons
  (pacify tools, tracking utilities, instant effects, emergency invulns, bard songs, durations below a
  level-scaled threshold — buff durations scale with caster level, so level 1's 3-minute Holy Armor is
  legitimate while 3 minutes at 50 is combat-tempo).
- **Heals/nukes/CC are *not* mutually exclusive across classes** — no game mechanic stops memorizing
  both a Cleric heal and a Druid heal, so only same-class redundant tiers ever collapse (unlike buffs,
  where a shared stacking line means exactly one pick). Fear/Root/Slow/Mesmerize each stay their own
  category — different CC tools you'd want separate picks for.
- **Memorize slot count is a user input, not hardcoded** — the real number wasn't confirmed pre-launch.
- **Level is one shared value for the whole 3-class combo**, though classes level independently after
  character level 10 (see GAME_NOTES.md). Simplification — revisit if it matters in practice.
- **Per-class "role affinity" is a derived score in its own file** (`data/class_roles.json`), keeping
  hand-authored lore archetypes separate from numbers that change with the scoring formula. Spell count
  per role, min-max normalized across classes; classes with no spell data (WAR/MNK/BER/ROG) excluded
  rather than hand-labeled.
- **Spell descriptions are generated from effects, not scraped.** The client has no prose tooltips for
  classic-era memorized spells (`dbstr_us.txt` only covers AA/passives) — the in-game description is
  itself generated from the effect list. `render_description` in `build_spells_raw.py` covers the
  common SPAs; unmapped SPAs are omitted rather than shown as raw numbers, since several store spell
  ids/flags in the value field (an honest incomplete description beats a fabricated-looking number).

## Known gaps / open items

- **Bard instrument scaling isn't modeled** — songs scale with instrument skill/mod at cast time (not
  in the spell file); affected effects are flagged `approximate: true` and shown at base value.
- **Client target type 56 isn't documented anywhere** — 10 beneficial SHM/DRU single-target spells
  (Scale of Wolf, Stoicism, the Snails/Tortoises/Slugs Healing line) use it and rumstil/eqspellparser
  doesn't list it. `derive_target` falls back on the AE radius (0 → `single`), which matches how they
  actually cast, and the raw label stays `"Type 56"` so the gap stays visible. Revisit if the id
  turns up documented.
- **18 wiki-indexed spells have no client match** (mostly Rogue disciplines and a few Wizard
  Al'Kabor nukes) and are dropped — revisit if the client updates.
- **~4% of spells have no generated description** (proc/trigger-style effects with no phrase template
  yet) and some SPAs aren't scored by the Buff Template ("no value for recipients" bucket) — extend
  `SPA_CONCEPTS`/`FIXED_PHRASES` as they come up.
- **Buff Template weights are a first encoding, not ground truth** — `TEMPLATE_ROLE_WEIGHTS` in
  `app/rank.js` is the single tuning table; recipient importance sliders are the user-facing layer.
- No per-class independent level input yet.
- Game launches 2026-07-28 — re-run `update_pipeline.py` after client patches; pass `--full`
  occasionally in case the wiki's spell index/icons changed.
