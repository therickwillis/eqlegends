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

// Role -> the raw wiki `kind` values that count toward it. Kept granular
// (pre-collapse) rather than our Buff/Nuke/DoT categories, since e.g. "Fear"
// vs "Root" vs "Slow" are different tools a player wants distinct picks for,
// not a single "Debuff" winner.
const ROLE_DEFINITIONS = {
  healer: {
    label: "Healer",
    kinds: ["Heal", "Healing", "Pet Heal", "Heal Over Time", "Duration Heals",
            "Duraiton Heals", "Regen", "HP/END/MANA Regen", "Cure", "Cure Poison"],
  },
  damage: {
    label: "Damage",
    kinds: ["Damage", "Direct Damage", "DD", "DD Cold", "Rain DD", "AE DD", "AE DD (quad)",
            "Rain Dmg", "Damage/Root", "Damage/Stun", "Damage Over Time", "DoT", "Dot", "DOT",
            "DOT Disease", "DOT Poison", "DoT/Debuff", "DoT/Snare", "Debuff/DoT",
            "Taps", "Lifetap"],
  },
  crowd_control: {
    label: "Crowd Control",
    kinds: ["Charm", "Fear", "Root", "Slow"],
  },
  debuffer: {
    label: "Debuffer",
    kinds: ["Detrimental", "Debuff", "Utility Detrimental", "Weaken", "Dispel"],
  },
  support: {
    label: "Utility / Support",
    kinds: ["Summon", "Pet Summon", "Summon Item", "Create Item", "Pet Proc", "Pet Haste",
            "Pet", "Travel", "Teleport", "Tradeskill", "Utility", "Mana"],
  },
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
 * Recommended buffs to memorize for a quick-buff pass: the single strongest
 * buff per distinct primary stat line across the selected classes, so you're
 * not memorizing two classes' AC/HP buffs when you only need the better one.
 * Note: only the spell's *primary* (first-listed) stat is used for grouping,
 * so a combo buff's secondary effects (e.g. Courage's AC + Max HP + HP) aren't
 * separately weighed against single-stat buffs of those same lines.
 */
function buffLoadout(classNames, level) {
  const candidates = SPELLS.filter(
    (s) => classNames.includes(s.class) && s.level <= level && s.category === "Buff"
  );
  const byStat = new Map();
  for (const s of candidates) {
    const key = s.primary_stat || s.description;
    byStat.set(key, betterSpell(byStat.get(key), s));
  }
  return [...byStat.values()].sort((a, b) => (spellPower(b) ?? 0) - (spellPower(a) ?? 0));
}

/**
 * Recommended combat/utility loadout for one or more roles: the single best
 * spell per distinct `kind` within the selected roles, across the selected
 * classes. Multiple kinds within a role (e.g. Fear + Root + Slow under Crowd
 * Control) all get their own pick since they're different tools, not
 * competing versions of the same thing.
 */
function roleLoadout(classNames, level, roleIds) {
  const kinds = new Set();
  roleIds.forEach((id) => ROLE_DEFINITIONS[id]?.kinds.forEach((k) => kinds.add(k)));

  const candidates = SPELLS.filter(
    (s) => classNames.includes(s.class) && s.level <= level && kinds.has(s.kind)
  );
  const byKind = new Map();
  for (const s of candidates) {
    byKind.set(s.kind, betterSpell(byKind.get(s.kind), s));
  }
  return [...byKind.values()].sort((a, b) => (spellPower(b) ?? 0) - (spellPower(a) ?? 0));
}
