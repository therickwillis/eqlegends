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
