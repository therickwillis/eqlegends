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

function resistKey(spell) {
  return spell.resist_type || "None";
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

// A buff's stacking line: two buffs with the same key don't stack (only the stronger lands), so
// the key IS the "pick one of these" set. From the precomputed signature (`stacking_groups`),
// which already namespaces bard songs; pet buffs land on the pet, not you, so they get their own
// namespace and never read as alternatives to a player buff. Buffs with no signature stand alone.
function buffLineKey(spell) {
  const confirmed = spell.stacking_confirmed && spell.stacking_groups.length > 0;
  const base = confirmed ? spell.stacking_groups[0].group_id : `solo:${spell.name}`;
  return (spell.target === "Pet" ? "pet:" : "") + base;
}

function buffLineLabel(spell) {
  const confirmed = spell.stacking_confirmed && spell.stacking_groups.length > 0;
  const label = confirmed ? spell.stacking_groups[0].label : spell.name;
  return spell.target === "Pet" ? `Pet: ${label}` : label;
}

/**
 * Builds the "best in slot" board for the Category Grid: the single best spell the selected
 * classes can field for each job/purpose at this level, plus the spells each pick makes redundant.
 * Two row kinds share one list (`kind`):
 *
 *   "category"  - heals, nukes, CC, debuffs, pets, utility. Keyed by category, and damage
 *                 categories split by resist element (a Fire nuke and a Magic nuke aren't
 *                 substitutes). `runnersUp` are weaker alternatives / lower tiers.
 *   "buff-line" - one row per stacking line (`buffLineKey`), so "best haste" and "best AC" are
 *                 distinct rows instead of one coarse "Buff". Its `runnersUp` are the spells that
 *                 share the line and so WON'T stack with the pick (`conflict: true`) - pick the
 *                 winner and you know what's pointless to also run.
 *
 * Every row: { kind, category, resistType, best, runnersUp, conflict }, where `category` doubles
 * as the row heading (the line label for buff rows) and best/runnersUp are the merged multi-class
 * entries from `rankedEntries`. Category rows sort first (alpha, element rows contiguous); buff
 * lines cluster after, alpha by label.
 */
function categoryTypeGrid(classNames, level) {
  const available = SPELLS.filter((s) => classNames.includes(s.class) && s.level <= level);
  const rows = [];

  // Non-buff rows: best per (category, element). Buffs are handled per stacking line below.
  const nonBuff = available.filter((s) => s.category !== "Buff");
  const byType = new Map(); // "category::element" -> spells
  for (const s of nonBuff) {
    const typeKey = `${s.category}::${resistKey(s)}`;
    (byType.get(typeKey) || byType.set(typeKey, []).get(typeKey)).push(s);
  }
  for (const [typeKey, spells] of byType) {
    const list = rankedEntries(spells, resistKey);
    const sep = typeKey.lastIndexOf("::");
    const element = typeKey.slice(sep + 2);
    rows.push({
      kind: "category",
      category: typeKey.slice(0, sep),
      resistType: element === "None" ? null : element,
      best: list[0],
      runnersUp: list.slice(1),
      conflict: false,
    });
  }

  // Buff rows: one per stacking line. `runnersUp` here are the same-line spells that won't stack.
  const buffLines = new Map(); // lineKey -> spells
  for (const s of available.filter((s) => s.category === "Buff")) {
    const k = buffLineKey(s);
    (buffLines.get(k) || buffLines.set(k, []).get(k)).push(s);
  }
  for (const spells of buffLines.values()) {
    const list = rankedEntries(spells, buffLineKey);
    rows.push({
      kind: "buff-line",
      category: buffLineLabel(list[0].spell),
      resistType: null,
      best: list[0],
      runnersUp: list.slice(1),
      conflict: true,
    });
  }

  // Category rows first (alpha, element rows contiguous, strongest first); buff lines cluster
  // after, alpha by label - a natural "reference table, then buffs you can't double up" order.
  const sortGroup = (r) => (r.kind === "category" ? 0 : 1);
  rows.sort(
    (a, b) =>
      sortGroup(a) - sortGroup(b) ||
      a.category.localeCompare(b.category) ||
      spellMagnitude(b.best.spell) - spellMagnitude(a.best.spell)
  );
  return rows;
}

// Role -> the effect categories that count toward it (post-collapse; Fear/
// Root/Slow are already their own categories so Crowd Control keeps them
// distinct without needing raw `kind` granularity).
const ROLE_DEFINITIONS = {
  healer: { label: "Healer", categories: ["Heal-Instant", "Heal-HoT", "Regen", "Cure"] },
  damage: { label: "Damage", categories: ["Nuke", "DoT", "Lifetap"] },
  crowd_control: { label: "Crowd Control", categories: ["Charm", "Fear", "Root", "Slow", "Mesmerize"] },
  debuffer: { label: "Debuffer", categories: ["Debuff"] },
  support: { label: "Utility / Support", categories: ["Pet/Summon", "Travel", "Tradeskill", "Utility"] },
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

/**
 * Recommended combat/utility loadout for one or more roles: the best (highest
 * level) spell per class per category within the selected roles. Unlike
 * buffs, heals/nukes/CC aren't mutually exclusive - there's no reason not to
 * memorize both a Cleric heal and a Druid heal - so this only collapses
 * same-class redundancy (e.g. Druid's Light Healing vs Superior Healing;
 * within one class + category, the higher-level spell is strictly the
 * current tier to use), not cross-class options.
 */
function roleLoadout(classNames, level, roleIds) {
  const categories = new Set();
  roleIds.forEach((id) => ROLE_DEFINITIONS[id]?.categories.forEach((c) => categories.add(c)));

  const candidates = SPELLS.filter(
    (s) => classNames.includes(s.class) && s.level <= level && categories.has(s.category)
  );
  const byClassCategory = new Map();
  for (const s of candidates) {
    const key = `${s.class}::${s.category}`;
    const current = byClassCategory.get(key);
    if (!current || s.level > current.level) byClassCategory.set(key, s);
  }
  return [...byClassCategory.values()].sort((a, b) => (spellPower(b) ?? 0) - (spellPower(a) ?? 0));
}
