// Comparison logic for the multi-class spell tool.
// Pure functions over the SPELLS/CATEGORIES/CLASSES data loaded from data.js.

/**
 * For a given class and level, return the highest-level spell in each
 * category that's <= the given level (i.e. the most recent/best version of
 * each spell line the class currently has).
 */
function bestSpellsForClassAtLevel(className, level) {
  const available = SPELLS.filter((s) => s.class === className && s.level <= level);
  const byCategory = new Map();
  for (const spell of available) {
    const current = byCategory.get(spell.category);
    if (!current || spell.level > current.level) {
      byCategory.set(spell.category, spell);
    }
  }
  return byCategory;
}

/**
 * Given up to 3 class names and a single level, find every effect category
 * where 2+ of the selected classes have an available spell, and return both
 * spells (with their stats) for side-by-side display. Categories covered by
 * only one class are returned separately as "unique" entries.
 */
function compareClasses(classNames, level) {
  const perClass = classNames.map((name) => ({
    name,
    spells: bestSpellsForClassAtLevel(name, level),
  }));

  const allCategories = new Set();
  perClass.forEach(({ spells }) => spells.forEach((_, cat) => allCategories.add(cat)));

  const overlapping = [];
  const unique = [];

  for (const category of allCategories) {
    const entries = perClass
      .filter(({ spells }) => spells.has(category))
      .map(({ name, spells }) => ({ className: name, spell: spells.get(category) }));

    if (entries.length >= 2) {
      overlapping.push({ category, entries });
    } else {
      unique.push({ category, entry: entries[0] });
    }
  }

  overlapping.sort((a, b) => a.category.localeCompare(b.category));
  unique.sort((a, b) => a.category.localeCompare(b.category));

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
    if (!cur || spellMagnitude(s) > spellMagnitude(cur)) perClass.set(k, s);
  }
  const bySpell = new Map(); // spell_id|name -> merged entry
  for (const s of perClass.values()) {
    const spellKey = s.spell_id ?? s.name;
    const entry = bySpell.get(spellKey);
    if (!entry) {
      bySpell.set(spellKey, { spell: s, classLevels: [{ class: s.class, level: s.level }] });
    } else {
      entry.classLevels.push({ class: s.class, level: s.level });
      if (spellMagnitude(s) > spellMagnitude(entry.spell)) entry.spell = s;
    }
  }
  const list = [...bySpell.values()];
  list.forEach((e) => e.classLevels.sort((a, b) => a.level - b.level));
  list.sort((a, b) => spellMagnitude(b.spell) - spellMagnitude(a.spell));
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
 * Each row: { category, subcategory, best, runnersUp, conflict } where best/runnersUp are the
 * merged multi-class entries from `rankedEntries` (same-class tiers collapsed, shared spells
 * merged). `conflict` is true for real buff/HoT stacking lines (stacking_confirmed) - then the
 * runners-up are same-line spells that WON'T stack with the pick; for nukes/heals/CC they're just
 * weaker or alternative options. Grouping into sections and section order live in renderGrid.
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

function spellLineGrid(classNames, level) {
  const available = SPELLS.filter((s) => classNames.includes(s.class) && s.level <= level);
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
      // Not best-in-slot: every variant is its own row, no winner and no runners-up.
      for (const entry of distinctSpellEntries(spells)) {
        rows.push({ category, subcategory, best: entry, runnersUp: [], conflict: false, collection: true });
      }
    } else {
      const list = rankedEntries(spells, (s) => s.line_id || s.name); // collapse tiers, merge shared
      rows.push({
        category,
        subcategory,
        best: list[0],
        runnersUp: list.slice(1),
        conflict: !!list[0].spell.stacking_confirmed,
      });
    }
  }
  return rows;
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

/** Picks the better of two spells: higher power wins; if neither has a
 * numeric power (e.g. a status effect like Fear/Charm), higher level wins. */
function betterSpell(a, b) {
  if (!a) return b;
  if (!b) return a;
  const pa = spellPower(a);
  const pb = spellPower(b);
  if (pa != null || pb != null) {
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

