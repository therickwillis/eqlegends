// Comparison logic for the multi-class spell tool.
// Pure functions over the SPELLS/CATEGORIES/CLASSES data loaded from data.js.

// --- Target scope ------------------------------------------------------------------------------
// How wide a spell reaches - self | single | group | aoe | pet - derived from the client's target
// type in build_spells_raw.py's derive_target(). Treated as a PARTITION, not a ranking: a
// single-target nuke and an AE nuke aren't competing for the same memorize slot (you bring both),
// so the boards give each its own row instead of crowning one on raw magnitude. Before this
// existed, "Direct Damage › Magic" for a Magician crowned the AE Upheaval and buried the
// single-target nuke under it as a "runner-up"; "Heals › Heals" did the reverse to the group heal.
const SCOPE_WIDTH = { self: 1, pet: 1, single: 2, group: 3, aoe: 4 };

function scopeWidth(spell) {
  return SCOPE_WIDTH[spell.target_scope] || 0;
}

// Row order within one spell line: the narrow, everyday tool first, then wider reach, pets last.
// "others" is the buff-line body key below - it sits where "single" does since that's what it
// usually holds.
const SCOPE_SORT = { self: 0, single: 1, others: 1, group: 2, aoe: 3, pet: 4 };

/**
 * Which spells share a row. Normally the scope itself.
 *
 * Buff stacking lines are the exception: Group Temperance and Temperance are the same client line
 * and genuinely knock each other out in-game, so splitting them by headcount would tell you to
 * memorize both. There the partition is the BODY the buff lands on - your own (self-only buffs),
 * your pet's, or anybody else's - which is exactly the namespace rule the Buff Template already
 * applies when resolving stacking conflicts (see nsPrefix in rank.js).
 */
function compareScopeKey(spell, lineIsStacking) {
  const scope = spell.target_scope || "single";
  if (!lineIsStacking) return scope;
  return scope === "self" || scope === "pet" ? scope : "others";
}

// Magnitude decides which of two spells is stronger; reach breaks a tie - at equal power a group
// buff beats its single-target sibling, because one cast covers everyone. Reach is ONLY ever a
// tiebreak, so it can't lift a weaker spell over a stronger one and no existing ranking moves.
function isStronger(spell, than) {
  const delta = spellMagnitude(spell) - spellMagnitude(than);
  return delta !== 0 ? delta > 0 : scopeWidth(spell) > scopeWidth(than);
}

function byStrength(a, b) {
  return spellMagnitude(b) - spellMagnitude(a) || scopeWidth(b) - scopeWidth(a);
}

/**
 * For a given class and level, return the highest-level spell in each
 * category+scope that's <= the given level (i.e. the most recent/best version of
 * each spell line the class currently has). Keyed by scope as well as category so a
 * class's "best Nuke" doesn't collapse its single-target and AE nukes into one winner.
 */
function bestSpellsForClassAtLevel(className, level) {
  const available = SPELLS.filter((s) => s.class === className && s.level <= level);
  const byCategory = new Map();
  for (const spell of available) {
    const key = `${spell.category}::${spell.target_scope || "single"}`;
    const current = byCategory.get(key);
    if (!current || spell.level > current.level) {
      byCategory.set(key, spell);
    }
  }
  return byCategory;
}

/**
 * Given up to 3 class names and a single level, find every effect category+scope
 * where 2+ of the selected classes have an available spell, and return both
 * spells (with their stats) for side-by-side display. Category+scopes covered by
 * only one class are returned separately as "unique" entries.
 */
function compareClasses(classNames, level) {
  const perClass = classNames.map((name) => ({
    name,
    spells: bestSpellsForClassAtLevel(name, level),
  }));

  const allKeys = new Set();
  perClass.forEach(({ spells }) => spells.forEach((_, key) => allKeys.add(key)));

  const overlapping = [];
  const unique = [];

  for (const key of allKeys) {
    const [category, scope] = key.split("::");
    const entries = perClass
      .filter(({ spells }) => spells.has(key))
      .map(({ name, spells }) => ({ className: name, spell: spells.get(key) }));

    if (entries.length >= 2) {
      overlapping.push({ category, scope, entries });
    } else {
      unique.push({ category, scope, entry: entries[0] });
    }
  }

  const byCategoryThenScope = (a, b) =>
    a.category.localeCompare(b.category) || (SCOPE_SORT[a.scope] ?? 9) - (SCOPE_SORT[b.scope] ?? 9);
  overlapping.sort(byCategoryThenScope);
  unique.sort(byCategoryThenScope);

  return { overlapping, unique };
}

// "Best" ranks by effect magnitude (damage/heal/buff values are stored signed - a nuke's
// HP delta is negative - so magnitude, not signed value, is what compares). Status effects
// with no numeric power (Fear/Charm/Root) fall back to spell level.
function spellMagnitude(spell) {
  const p = spellPower(spell);
  return p != null ? Math.abs(p) : spell.level;
}

// Collapses a list of spells into ranked multi-class entries keyed by `keyOf`: within one key
// only the strongest tier per class survives (you don't list five tiers of your own fire nuke),
// then classes sharing the identical spell (same spell_id) merge into one entry carrying every
// class that gets it - the shape the grid/template rows render. Returns entries strongest-first.
function rankedEntries(spells, keyOf) {
  const perClass = new Map(); // `${class}::${key}` -> strongest spell
  for (const s of spells) {
    const k = `${s.class}::${keyOf(s)}`;
    const cur = perClass.get(k);
    if (!cur || isStronger(s, cur)) perClass.set(k, s);
  }
  const bySpell = new Map(); // spell_id|name -> merged entry
  for (const s of perClass.values()) {
    const spellKey = s.spell_id ?? s.name;
    const entry = bySpell.get(spellKey);
    if (!entry) {
      bySpell.set(spellKey, { spell: s, classLevels: [{ class: s.class, level: s.level }] });
    } else {
      entry.classLevels.push({ class: s.class, level: s.level });
      if (isStronger(s, entry.spell)) entry.spell = s;
    }
  }
  const list = [...bySpell.values()];
  list.forEach((e) => e.classLevels.sort((a, b) => a.level - b.level));
  list.sort((a, b) => byStrength(a.spell, b.spell));
  return list;
}

/**
 * Builds the "best in slot" board for the Category Grid, organized entirely by the game client's
 * own spell-line taxonomy: the parent Category (e.g. "Direct Damage", "HP Buffs") is the section,
 * and each Subcategory (e.g. "Fire", "Shielding") is one row = one line. This is the game's own
 * two-level grouping, so it subsumes what the old grid did by hand - damage already splits by
 * element (Direct Damage › Fire vs › Magic), and every buff line ("HP Buffs › HP type one",
 * "Statistic Buffs › Armor Class") is its own row instead of one coarse "Buff".
 *
 * A line can produce more than one row: rows are partitioned by `compareScopeKey`, so a line
 * holding both a single-target and an AE nuke yields one row each instead of ranking them against
 * each other. See that function for why buff lines partition differently.
 *
 * Each row: { category, subcategory, scopeKey, best, runnersUp, conflict } where best/runnersUp
 * are the merged multi-class entries from `rankedEntries` (same-class tiers collapsed, shared
 * spells merged). `conflict` is true for real buff/HoT stacking lines (stacking_confirmed) - then
 * the runners-up are same-line spells that WON'T stack with the pick; for nukes/heals/CC they're
 * just weaker or alternative options. Grouping into sections and section order live in renderGrid.
 */
// Some lines aren't a "best in slot" at all - they're a set of equivalent variants where no one
// spell beats another (an Enchanter's Illusion: Dwarf isn't better than Illusion: Dark Elf). For
// those we list every spell instead of collapsing to a single winner. Detected by the client's own
// subcategory (Illusion: *, Visages).
function isCollectionLine(subcategory) {
  return /illusion|visage/i.test(subcategory || "");
}

// Every distinct spell in a set, merging only truly-identical spells (same spell_id) across the
// classes that share them. Unlike rankedEntries it does NOT collapse a class's lower tiers, so all
// variants survive - what a collection line needs. Sorted alphabetically by name.
function distinctSpellEntries(spells) {
  const bySpell = new Map(); // spell_id|name -> entry
  for (const s of spells) {
    const key = s.spell_id ?? s.name;
    const entry = bySpell.get(key);
    if (!entry) {
      bySpell.set(key, { spell: s, classLevels: [{ class: s.class, level: s.level }] });
    } else {
      entry.classLevels.push({ class: s.class, level: s.level });
      if (spellMagnitude(s) > spellMagnitude(entry.spell)) entry.spell = s;
    }
  }
  const list = [...bySpell.values()];
  list.forEach((e) => e.classLevels.sort((a, b) => a.level - b.level));
  list.sort((a, b) => a.spell.name.localeCompare(b.spell.name));
  return list;
}

// `scopes`, when given, is a Set of target scopes to keep (the board views' scope filter).
// Filtering the spells rather than the finished rows keeps runners-up honest: a row never lists a
// rival you've filtered out of view.
function spellLineGrid(classNames, level, scopes) {
  const available = SPELLS.filter(
    (s) =>
      classNames.includes(s.class) &&
      s.level <= level &&
      (!scopes || scopes.has(s.target_scope || "single"))
  );
  const byLine = new Map(); // line_id ("Category:Subcategory") -> spells
  for (const s of available) {
    const key = s.line_id || `Other:${s.name}`;
    (byLine.get(key) || byLine.set(key, []).get(key)).push(s);
  }
  const rows = [];
  for (const spells of byLine.values()) {
    const category = spells[0].line_category || "Other";
    const subcategory = spells[0].line_subcategory || "";
    if (isCollectionLine(subcategory)) {
      // Not best-in-slot: every variant is its own row, no winner and no runners-up. Already one
      // row per spell, so scope has nothing left to partition - it only labels the row.
      for (const entry of distinctSpellEntries(spells)) {
        rows.push({
          category,
          subcategory,
          scopeKey: compareScopeKey(entry.spell, false),
          best: entry,
          runnersUp: [],
          conflict: false,
          collection: true,
        });
      }
      continue;
    }
    // "Is this a real buff line" is a fact about the line, even though stacking_confirmed is a
    // per-spell flag - one confirmed member makes the whole line one.
    const lineIsStacking = spells.some((s) => s.stacking_confirmed);
    const byScope = new Map(); // scope key -> the spells competing under it
    for (const s of spells) {
      const key = compareScopeKey(s, lineIsStacking);
      (byScope.get(key) || byScope.set(key, []).get(key)).push(s);
    }
    for (const [scopeKey, scoped] of byScope) {
      const list = rankedEntries(scoped, (s) => s.line_id || s.name); // collapse tiers, merge shared
      rows.push({
        category,
        subcategory,
        scopeKey,
        // Did this line actually split? Only then does a row need to say its target out loud - the
        // dense views use this to keep the other ~60% of line labels uncluttered. Note it's
        // computed after the scope filter, so filtering down to one target drops the suffix too.
        split: byScope.size > 1,
        best: list[0],
        runnersUp: list.slice(1),
        conflict: !!list[0].spell.stacking_confirmed,
      });
    }
  }
  return rows;
}

// Sort weight for a row's scope, so every view orders a line's rows the same way.
function rowScopeSort(row) {
  return SCOPE_SORT[row.scopeKey] ?? 9;
}

// The play-style archetypes the Rank Lab scores against - its only remaining consumer, and the
// keys DEFAULT_GROUP_WEIGHTS (rank.js) and classify_roles.py are both keyed by. These used to
// also drive a "Grouping Roles" checkbox row and a Grouping Loadout section; both are gone.
const ARCHETYPES = {
  healer: "Healer",
  damage: "Damage",
  crowd_control: "Crowd Control",
  debuffer: "Debuffer",
  support: "Utility / Support",
};

function spellPower(spell) {
  return spell.total_effect ?? spell.primary_value ?? null;
}

/** Picks the better of two spells: higher power wins, with wider reach as the tiebreak; if
 * neither has a numeric power (e.g. a status effect like Fear/Charm), higher level wins. */
function betterSpell(a, b) {
  if (!a) return b;
  if (!b) return a;
  const pa = spellPower(a);
  const pb = spellPower(b);
  if (pa != null || pb != null) {
    if (pa === pb) return scopeWidth(b) > scopeWidth(a) ? b : a;
    return (pb ?? -Infinity) > (pa ?? -Infinity) ? b : a;
  }
  return b.level > a.level ? b : a;
}

/**
 * Recommended buffs to memorize for a quick-buff pass. Buffs occupy a real
 * in-game "slot" (e.g. AC Slot 1), and two buffs sharing any slot don't
 * stack - only the stronger one takes effect. `stacking_groups` (sourced from
 * eqlwiki.com's Buff Lines page) lists every slot a spell occupies; a combo
 * buff like Courage occupies more than one (AC *and* HP), so this is a greedy
 * set-cover: take spells strongest-first, skip any that share an already-
 * claimed slot with a spell we already picked, and claim all of its slots
 * when picked. Buffs with no known stacking data (not on that wiki page -
 * roughly 25% of Buff-category spells, mostly newer/undocumented ones) get a
 * synthetic per-spell group so they're never assumed to conflict with
 * anything, and are flagged `confirmed: false` so the UI can call that out.
 */
function buffLoadout(classNames, level) {
  const candidates = SPELLS.filter(
    (s) => classNames.includes(s.class) && s.level <= level && s.category === "Buff"
  );
  const sorted = [...candidates].sort((a, b) => (spellPower(b) ?? 0) - (spellPower(a) ?? 0));

  const claimed = new Set();
  const picks = [];
  for (const spell of sorted) {
    const confirmed = spell.stacking_confirmed && spell.stacking_groups.length > 0;
    const groupIds = confirmed
      ? spell.stacking_groups.map((g) => g.group_id)
      : [`unconfirmed:${spell.class}:${spell.name}`];

    if (groupIds.some((id) => claimed.has(id))) continue;
    groupIds.forEach((id) => claimed.add(id));
    picks.push({ ...spell, confirmed });
  }
  return picks;
}

