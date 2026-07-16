// Client-side port of rank_spells.py's weighted, multi-stat spell ranking -
// used by the "Rank Lab" tab. Kept in sync manually with the Python version
// (can't share code across Python/JS); see rank_spells.py's module docstring
// for the full rationale (spellPower only reading a spell's first effect,
// the Max-HP/HP wiki-duplication fix, etc.).

// Groups the raw wiki stat vocabulary by what it actually does for a player.
// An archetype's weight for a stat is normally just its group's weight -
// individual stats only get an override when they genuinely diverge from
// their group for a given archetype (see STAT_OVERRIDES below).
const STAT_GROUPS = {
  "HP": "heal", "Max HP": "heal",
  "HP Regen": "sustain", "HP/End Regen": "sustain", "Mana": "sustain",
  "AC": "mitigation", "Damage Shield": "mitigation",
  "Invul": "mitigation", "Absorption": "mitigation", "Dmg Absorb": "mitigation",
  "Magic Resist": "resist", "Cold Resist": "resist", "Fire Resist": "resist",
  "Poison Resist": "resist", "Disease Resist": "resist",
  "ATK": "damage", "STR": "damage", "AGI": "damage", "DEX": "damage", "Dmg": "damage",
  "WIS": "caster_stat", "INT": "caster_stat",
  "STA": "misc", "CHA": "misc", "Hate Reduction": "misc",
};

const GROUP_ORDER = ["heal", "sustain", "mitigation", "resist", "damage", "caster_stat", "misc"];

const GROUP_LABELS = {
  heal: "Heal (HP / Max HP)",
  sustain: "Sustain (Regen / Mana)",
  mitigation: "Mitigation (AC / Absorb / Invul)",
  resist: "Resist (elemental)",
  damage: "Damage (ATK / STR / AGI / DEX)",
  caster_stat: "Caster Stat (WIS / INT)",
  misc: "Misc (STA / CHA / other)",
};

const DEFAULT_WEIGHT = 0.3; // fallback for any stat not covered by a group

// points per group, per archetype - first-draft placeholder, tunable live
// via the Rank Lab sliders. Reuses the archetype vocabulary already
// established in ROLE_DEFINITIONS (compare.js) / classify_roles.py.
const DEFAULT_GROUP_WEIGHTS = {
  healer: { heal: 1.0, sustain: 2.0, mitigation: 0.6, resist: 0.5, damage: 0.3, caster_stat: 1.5, misc: 0.4 },
  damage: { heal: 0.5, sustain: 0.8, mitigation: 0.3, resist: 0.3, damage: 1.5, caster_stat: 0.3, misc: 0.2 },
  support: { heal: 1.2, sustain: 2.0, mitigation: 1.2, resist: 1.0, damage: 0.4, caster_stat: 0.5, misc: 0.6 },
  // Left low-effort (barely touch Buff-category spells for their core job).
  crowd_control: { heal: 0.3, sustain: 0.3, mitigation: 0.3, resist: 0.3, damage: 0.3, caster_stat: 0.3, misc: 0.3 },
  debuffer: { heal: 0.3, sustain: 0.3, mitigation: 0.3, resist: 0.3, damage: 0.3, caster_stat: 0.3, misc: 0.3 },
};

// Sparse per-stat exceptions where a stat genuinely diverges from its
// group's default for a given archetype. Fixed for now (not slider-tunable) -
// only the 7 group weights above are exposed as sliders.
const STAT_OVERRIDES = {
  healer: { WIS: 2.0, INT: 1.0, "HP Regen": 3.0 },
  damage: { ATK: 2.0, STR: 1.5 },
};

function cloneGroupWeights() {
  return JSON.parse(JSON.stringify(DEFAULT_GROUP_WEIGHTS));
}

function statWeight(groupWeights, archetype, stat) {
  const overrides = STAT_OVERRIDES[archetype];
  if (overrides && overrides[stat] != null) return overrides[stat];
  const group = STAT_GROUPS[stat];
  if (group && groupWeights[archetype] && groupWeights[archetype][group] != null) {
    return groupWeights[archetype][group];
  }
  return DEFAULT_WEIGHT;
}

function effectValue(effect) {
  return effect.value;
}

// Effects now come from the game client's own spell-effect slots (SPA ids), not from
// re-parsing free wiki text, so the old HP/Max-HP double-counting guard (two wiki lines
// describing the same underlying stat) no longer applies - see rank_spells.py.
function dedupedEffects(spell) {
  return spell.effects || [];
}

function weightedScore(spell, archetype, groupWeights) {
  let total = 0;
  const breakdown = [];
  for (const e of dedupedEffects(spell)) {
    const value = effectValue(e);
    if (value == null) continue;
    const weight = statWeight(groupWeights, archetype, e.stat);
    // Damage-ish categories (Nuke/DoT/Debuff) store some effects as negative
    // numbers (see docs/PROJECT_GOALS.md) - rank by magnitude, not signed
    // value, matching categoryGrid()'s Math.abs() convention in compare.js.
    // `value` (signed) is still shown in the breakdown for clarity.
    const points = Math.abs(value) * weight;
    total += points;
    breakdown.push({ stat: e.stat, value, weight, points });
  }
  return { total, breakdown };
}

// Buff spells occupy a real stacking slot (see buffLoadout() in compare.js);
// only one spell per slot is ever actually usable at once, so ranking within
// a slot is what tells you which of several competing options actually wins.
function slotLabel(spell) {
  if (spell.category !== "Buff") return "—";
  if (!spell.stacking_groups || spell.stacking_groups.length === 0 || !spell.stacking_confirmed) {
    return "Unconfirmed";
  }
  return spell.stacking_groups.map((g) => g.label).join(" + ");
}

// The same spell (same spell_id) is often castable by several selected classes, each at its
// own level (data/spells.json has one row per class) - e.g. Lull is Cleric Lv 1, Enchanter
// Lv 1, and Paladin Lv 10 all sharing spell_id 208. Group those into a single ranked row
// instead of listing the identical spell once per class.
function groupBySpell(candidates) {
  const groups = new Map();
  for (const spell of candidates) {
    const key = spell.spell_id ?? spell.name;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(spell);
  }
  return [...groups.values()];
}

function rankSpells(classNames, level, category, archetype, groupWeights) {
  const candidates = SPELLS.filter(
    (s) => s.category === category && classNames.includes(s.class) && s.level <= level
  );
  const scored = groupBySpell(candidates).map((group) => {
    // Score/display using whichever class gets it at the highest level - buff/effect
    // magnitudes scale with caster level, so that's the strongest version actually available.
    const spell = group.reduce((best, s) => (s.level > best.level ? s : best), group[0]);
    const classLevels = group
      .map((s) => ({ class: s.class, level: s.level }))
      .sort((a, b) => a.level - b.level);
    const { total, breakdown } = weightedScore(spell, archetype, groupWeights);
    return { spell, classLevels, score: total, breakdown, slot: slotLabel(spell) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// ============================= Quick Buff template engine =============================
//
// Most players keep one saved spell-book template just for group buffing (Quick Buff),
// separate from their combat loadout. What belongs in it is NOT "highest stat number wins":
// a buff's value depends on WHO receives it (Haste is gold on a melee, worthless on a
// wizard; Clarity-line mana regen is the reverse), on duration (a 12-second bard song or an
// 18-second emergency invulnerability can't be pre-buffed), and on whether the spell is
// even a buff at all (Lull is a pacify tool you cast on enemies; Sense Animals is tracking).
//
// So the engine works in three stages:
//   1. Hard exclusion rules with human-readable reasons (auditable in the UI).
//   2. Per-recipient-role scoring: each effect maps to a gameplay concept (maxhp, haste,
//      mana regen, ...) and each recipient role (Tank / Melee / Caster / Healer / Pets)
//      weighs concepts by what that role actually cares about. A buff's template value is
//      the sum over enabled recipients, weighted by the per-role importance sliders - one
//      gem that serves the whole group (Temperance) outranks a same-size single-role buff.
//   3. Greedy set-cover over real stacking lines, tracking which rivals each pick beat so
//      the UI can say WHY this spell and not that one.

// SPA id -> gameplay concept. Only concepts listed here contribute to template score;
// haste (SPA 11) is stored by the client as 100+bonus so it's normalized in conceptsFor().
const SPA_CONCEPTS = {
  69: "maxhp", 1: "ac", 7: "sta", 4: "str", 5: "dex", 6: "agi",
  9: "wis", 8: "int", 10: "cha", 2: "atk", 11: "haste",
  59: "ds", 55: "rune", 78: "rune",
  46: "resist", 47: "resist", 48: "resist", 49: "resist", 50: "resist",
  3: "move", 15: "manaregen", 79: "hpkick", 0: "hpregen", 85: "proc",
};

// Resist SPAs split back out to their element so the template can include only the
// resist types the user actually wants (checkbox set in the Buff Template tab).
const RESIST_SPA_ELEMENT = { 46: "fire", 47: "cold", 48: "poison", 49: "disease", 50: "magic" };

const CONCEPT_LABELS = {
  maxhp: "Max HP", ac: "AC", sta: "STA", str: "STR", dex: "DEX", agi: "AGI",
  wis: "WIS", int: "INT", cha: "CHA", atk: "ATK", haste: "% Haste",
  ds: "Damage Shield", rune: "Rune (absorb)", resist: "Resist",
  move: "% Run Speed", manaregen: "Mana/tick", hpkick: "HP on land",
  hpregen: "HP/tick", proc: "Weapon Proc",
};

// What each recipient role is worth per point of each concept. These encode game knowledge,
// not preference: haste is a melee's single biggest buff; Clarity-line regen is a caster's;
// AC/MaxHP/DS define a tank; the one-time HP top-up on a Temperance-style buff (hpkick) is
// nearly worthless as *template* value. Role IMPORTANCE (the sliders) is the user's
// preference layer on top of these.
const TEMPLATE_ROLE_WEIGHTS = {
  tank:   { maxhp: 1.0, ac: 1.5, sta: 0.8, ds: 3, rune: 0.1, agi: 0.2, atk: 0.2, str: 0.2,
            haste: 1, resist: 0.3, move: 0.4, hpregen: 5, hpkick: 0.02, proc: 15 },
  melee:  { haste: 8, atk: 1.2, str: 1.0, dex: 0.8, ds: 2, maxhp: 0.4, ac: 0.4, sta: 0.4,
            agi: 0.3, resist: 0.2, move: 0.4, hpregen: 2, hpkick: 0.02, proc: 30 },
  caster: { manaregen: 40, int: 0.6, maxhp: 0.3, ac: 0.3, sta: 0.2, resist: 0.3, rune: 0.15,
            move: 0.4, hpkick: 0.02 },
  healer: { manaregen: 40, wis: 0.8, maxhp: 0.3, ac: 0.3, sta: 0.2, resist: 0.3,
            move: 0.4, hpkick: 0.02 },
  pets:   { haste: 6, ds: 2, atk: 0.8, str: 0.6, maxhp: 0.3, ac: 0.3, hpkick: 0.02, proc: 20 },
};

const TEMPLATE_ROLE_LABELS = { self: "Self (own trio)", tank: "Tank", melee: "Melee DPS", caster: "Caster", healer: "Healer", pets: "Pets" };
const TEMPLATE_ROLE_ORDER = ["self", "tank", "melee", "caster", "healer", "pets"];

// Self-only buffs (Shielding line, Barbcoat, Lich, Yaulp...) can't be cast on groupmates,
// but in EQ Legends the trio IS one character - a caster build keeps its own Shielding up
// permanently. So "Self" is its own recipient whose weights derive from what the selected
// classes can actually use: haste/ATK only score if the trio melees, mana regen only if it
// casts. Element-wise max across the applicable role tables = "what could my own body use".
const MELEE_CAPABLE = new Set(["Warrior", "Monk", "Rogue", "Berserker", "Paladin", "Shadow Knight", "Ranger", "Bard", "Beastlord"]);
const TANK_CAPABLE = new Set(["Warrior", "Paladin", "Shadow Knight", "Ranger", "Beastlord"]);
const PRIESTS = new Set(["Cleric", "Druid", "Shaman"]);
const PURE_MELEE = new Set(["Warrior", "Monk", "Rogue", "Berserker"]);

function selfRoleWeights(classNames) {
  const tables = [];
  if (classNames.some((c) => TANK_CAPABLE.has(c))) tables.push(TEMPLATE_ROLE_WEIGHTS.tank);
  if (classNames.some((c) => MELEE_CAPABLE.has(c))) tables.push(TEMPLATE_ROLE_WEIGHTS.melee);
  if (classNames.some((c) => !PURE_MELEE.has(c))) tables.push(TEMPLATE_ROLE_WEIGHTS.caster);
  if (classNames.some((c) => PRIESTS.has(c))) tables.push(TEMPLATE_ROLE_WEIGHTS.healer);
  const merged = {};
  for (const table of tables) {
    for (const [concept, w] of Object.entries(table)) {
      merged[concept] = Math.max(merged[concept] || 0, w);
    }
  }
  return merged;
}

// SPAs that mark a spell as on-demand utility rather than a pre-cast buff, with the reason
// shown when it's excluded. Only applied when the spell has no real stat concepts (a combo
// buff that happens to carry a utility rider still counts as a buff).
const UTILITY_SPA_REASONS = {
  18: "pacify tool — cast on enemies mid-crawl, not pre-buffed",
  30: "pacify tool — cast on enemies mid-crawl, not pre-buffed",
  86: "pacify tool — cast on enemies mid-crawl, not pre-buffed",
  52: "tracking utility (sense dead)",
  53: "tracking utility (sense summoned)",
  54: "tracking utility (sense animals)",
  61: "identify utility",
  63: "memblur tool — cast in combat, not a buff",
  68: "reclaims your own pet for mana — not a buff",
  27: "dispel tool — cast at enemies/to strip buffs",
  67: "scouting eye — on-demand utility",
  73: "bind sight — on-demand utility",
  77: "corpse-finding utility",
  56: "true north utility",
  12: "invisibility — situational, cast when needed",
  28: "invis vs undead — situational, cast when needed",
  29: "invis vs animals — situational, cast when needed",
  57: "levitate — situational, cast when needed",
  74: "feign death — emergency tool",
  42: "shadow step — escape tool",
  58: "illusion — cosmetic/faction utility",
};

const DIVINE_AURA_SPA = 40;
const MIN_TEMPLATE_DURATION_S = 300; // 5 min: real template buffs run 10-40 min; combat HoTs ~24s

// Normalizes a spell's display effects into {concept, amount} pairs.
function conceptsFor(spell) {
  const out = [];
  for (const e of spell.effects || []) {
    const concept = SPA_CONCEPTS[e.spa];
    if (!concept) continue;
    let amount = e.value;
    if (concept === "haste") amount = e.value - 100; // client stores haste as 100+bonus%
    if (concept === "hpregen" && amount < 0) continue; // negative HP/tick = DoT, not regen
    if (amount <= 0 && concept !== "hpkick") continue; // debuff-side values give no template value
    const item = { concept, amount };
    if (concept === "resist") item.element = RESIST_SPA_ELEMENT[e.spa]; // tag element for the resist filter
    out.push(item);
  }
  // Weapon procs store a spell id, not a magnitude - score presence, not the raw number.
  if ((spell.spas || []).includes(85)) out.push({ concept: "proc", amount: 1 });
  return out;
}

// Returns {score, perRole: {role: score}} for the enabled recipients. Self-only buffs score
// against the trio-derived Self weights and nothing else; castable-on-others buffs score
// against the group roles (your own body is one of those group bodies, so scoring it again
// under Self would double count).
// resistSet (a Set of element ids, e.g. {"fire","cold"}) limits which resist effects count.
// Undefined means "all resists" (backward-compatible). Filtering here means unselected resist
// elements contribute nothing to the score AND never surface in the "why" line.
function templateScore(spell, recipients, selfWeights, resistSet) {
  const concepts = conceptsFor(spell).filter(
    (c) => c.concept !== "resist" || !resistSet || resistSet.has(c.element)
  );
  const selfOnly = spell.target === "Self";
  const petOnly = spell.target === "Pet";
  const perRole = {};
  let total = 0;
  for (const role of TEMPLATE_ROLE_ORDER) {
    const r = recipients[role];
    if (!r || !r.enabled) continue;
    if (selfOnly !== (role === "self")) continue;
    if (petOnly !== (role === "pets") && !selfOnly) continue;
    const weights = role === "self" ? selfWeights : TEMPLATE_ROLE_WEIGHTS[role];
    let roleScore = 0;
    for (const { concept, amount } of concepts) {
      roleScore += (weights[concept] || 0) * amount;
    }
    if (roleScore > 0) {
      perRole[role] = roleScore * r.importance;
      total += perRole[role];
    }
  }
  return { score: total, perRole, concepts };
}

// Buff durations scale with caster level (a 27-minute buff at 40 is a 3-minute buff at 5),
// so the "too short to pre-buff" bar has to scale too: a level-1 group absolutely runs on
// 3-minute Holy Armor, while at 25+ anything under 5 minutes is combat-tempo, not template.
function minTemplateDuration(level) {
  return Math.min(MIN_TEMPLATE_DURATION_S, 60 + level * 12);
}

// Human-readable group headers for the excluded list, keyed by exclusion kind.
const EXCLUSION_GROUP_LABELS = {
  emergency: "Emergency buttons — memorize separately, don't pre-buff",
  utility: "On-demand utility, not a buff",
  instant: "Instant effects — nothing stays on the target",
  short: "Too short to pre-buff (buff durations scale with level)",
  song: "Bard songs — maintained by twisting in combat",
  "self-off": "Self-only buffs (Self recipient is off)",
  "pets-off": "Pet buffs (Pets recipient is off)",
  "resist-off": "Resist buffs (none of their elements are selected above)",
  "no-value": "No value for the selected recipients",
};

// Stage 1: hard exclusions. Returns {key, text} for the excluded list, or null if the spell
// is a candidate. Rule order matters for reason quality: identity rules (what the spell IS)
// come before numeric rules, so Sense Animals reads "tracking utility", not "Instant".
function templateExclusionReason(spell, recipients, level, resistSet) {
  const spas = spell.spas || [];
  if (spas.includes(DIVINE_AURA_SPA)) {
    return { key: "emergency", text: "invulnerability for oh-crap moments" };
  }
  const concepts = conceptsFor(spell);
  const hasRealStats = concepts.some((c) => c.concept !== "cha" && c.concept !== "hpkick");
  if (!hasRealStats) {
    for (const spa of spas) {
      if (UTILITY_SPA_REASONS[spa]) return { key: "utility", text: UTILITY_SPA_REASONS[spa] };
    }
  }
  if (spell.duration_seconds === 0) {
    return { key: "instant", text: "instant effect" };
  }
  if (spell.duration_seconds != null && spell.duration_seconds < minTemplateDuration(level)) {
    if (spell.class === "Bard") {
      return { key: "song", text: `${spell.duration} song` };
    }
    return { key: "short", text: `${spell.duration} — expires before the pull` };
  }
  if (spell.target === "Self" && !(recipients.self && recipients.self.enabled)) {
    return { key: "self-off", text: "self-only buff" };
  }
  if (spell.target === "Pet" && !(recipients.pets && recipients.pets.enabled)) {
    return { key: "pets-off", text: "pet-only buff" };
  }
  // A buff whose only real value is resists, none of which the user selected, has nothing left
  // to offer the template - drop it with a specific reason instead of a vague "no value".
  const real = concepts.filter((c) => c.concept !== "cha" && c.concept !== "hpkick");
  if (
    real.length > 0 &&
    real.every((c) => c.concept === "resist") &&
    !real.some((c) => !resistSet || resistSet.has(c.element))
  ) {
    const elems = [...new Set(real.map((c) => c.element).filter(Boolean))].join("/");
    return { key: "resist-off", text: `${elems} resist — not selected for the template` };
  }
  return null;
}

/**
 * The Quick Buff template: picks (greedy set-cover over stacking lines, best score first,
 * each pick recording the rivals it beat for its line) plus the auditable excluded list.
 * Long-duration Heal-HoTs are included as candidates - the Regeneration/Chloroplast line
 * (8-14 min) is a classic template buff even though it's categorized as a heal; the 24s
 * Celestial-style combat HoTs get excluded by the duration rule.
 */
function suggestedBuffTemplate(classNames, level, recipients, resistSet) {
  const candidates = SPELLS.filter(
    (s) =>
      classNames.includes(s.class) &&
      s.level <= level &&
      (s.category === "Buff" ||
        (s.category === "Heal-HoT" && s.duration_seconds != null && s.duration_seconds >= MIN_TEMPLATE_DURATION_S))
  );

  const selfWeights = selfRoleWeights(classNames);
  const excluded = [];
  const scored = [];
  for (const group of groupBySpell(candidates)) {
    const spell = group.reduce((best, s) => (s.level > best.level ? s : best), group[0]);
    const classLevels = group
      .map((s) => ({ class: s.class, level: s.level }))
      .sort((a, b) => a.level - b.level);

    const reason = templateExclusionReason(spell, recipients, level, resistSet);
    if (reason) {
      excluded.push({ spell, classLevels, reason });
      continue;
    }
    const { score, perRole, concepts } = templateScore(spell, recipients, selfWeights, resistSet);
    if (score <= 0) {
      excluded.push({ spell, classLevels, reason: { key: "no-value", text: "effect not modeled or wrong audience" } });
      continue;
    }
    scored.push({ spell, classLevels, score, perRole, concepts });
  }
  scored.sort((a, b) => b.score - a.score);

  const claimedBy = new Map(); // stacking group id -> pick entry that owns it
  const picks = [];
  for (const entry of scored) {
    const confirmed = entry.spell.stacking_confirmed && entry.spell.stacking_groups.length > 0;
    // Stacking conflicts only exist between buffs landing on the SAME body. Self-only buffs
    // live on your body alongside whatever the group template puts there (your own Shielding
    // + a Temperance cast on you coexist in-game), and pet buffs land on the pet - so each
    // competes in its own namespace instead of knocking group buffs out of their lines (or
    // vice versa: Harnessing of Spirit was knocking out Burnout via a shared STR line).
    const nsPrefix = entry.spell.target === "Self" ? "self:" : entry.spell.target === "Pet" ? "pet:" : "";
    const groupIds = confirmed
      ? entry.spell.stacking_groups.map((g) => nsPrefix + g.group_id)
      : [`unconfirmed:${entry.spell.name}`];
    const blocker = groupIds.map((id) => claimedBy.get(id)).find(Boolean);
    if (blocker) {
      blocker.beat.push(entry);
      continue;
    }
    const pick = { ...entry, confirmed, beat: [] };
    groupIds.forEach((id) => claimedBy.set(id, pick));
    picks.push(pick);
  }
  picks.forEach((p) => { p.why = templateWhy(p, selfWeights); });
  return { picks, excluded };
}

// One-liner "why this pick": dominant role + its top concepts, e.g.
// "Tank +1040 (800 Max HP, 160 AC) — beats Symbol of Naltron, Courage".
function templateWhy(pick, selfWeights) {
  const roles = Object.entries(pick.perRole).sort((a, b) => b[1] - a[1]);
  if (roles.length === 0) return "";
  const [topRole, topScore] = roles[0];
  const weights = topRole === "self" ? (selfWeights || {}) : TEMPLATE_ROLE_WEIGHTS[topRole];
  const topConcepts = pick.concepts
    .filter((c) => (weights[c.concept] || 0) > 0 && c.concept !== "hpkick")
    .sort((a, b) => (weights[b.concept] || 0) * b.amount - (weights[a.concept] || 0) * a.amount)
    .slice(0, 2)
    .map((c) => (c.concept === "proc" ? "adds a weapon proc" : `${c.amount} ${CONCEPT_LABELS[c.concept]}`));
  const breadth = roles.length > 1 ? ` · ${roles.length} roles benefit` : "";
  let why = `${TEMPLATE_ROLE_LABELS[topRole]} +${topScore.toFixed(0)} (${topConcepts.join(", ")})${breadth}`;
  if (pick.beat.length > 0) {
    const rivals = pick.beat.slice(0, 2).map((r) => r.spell.name).join(", ");
    const more = pick.beat.length > 2 ? ` +${pick.beat.length - 2} more` : "";
    why += ` — beats ${rivals}${more}`;
  }
  if (pick.spell.target === "Self") why += " · self-only";
  return why;
}
