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

// Role -> the effect categories that count toward it (post-collapse; Fear/
// Root/Slow are already their own categories so Crowd Control keeps them
// distinct without needing raw `kind` granularity).
const ROLE_DEFINITIONS = {
  healer: { label: "Healer", categories: ["Heal-Instant", "Heal-HoT", "Regen", "Cure"] },
  damage: { label: "Damage", categories: ["Nuke", "DoT", "Lifetap"] },
  crowd_control: { label: "Crowd Control", categories: ["Charm", "Fear", "Root", "Slow"] },
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
