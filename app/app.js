const classSelects = [
  document.getElementById("class1"),
  document.getElementById("class2"),
  document.getElementById("class3"),
];
const levelInput = document.getElementById("level");
const slotsInput = document.getElementById("slots");
const resultsEl = document.getElementById("results");
const buffLoadoutEl = document.getElementById("buff-loadout");
const buffSlotMeterEl = document.getElementById("buff-slot-meter");
const tabButtons = [...document.querySelectorAll(".tab-btn")];
const gridTableEl = document.getElementById("category-grid");
const rankArchetypeSelect = document.getElementById("rank-archetype");
const rankCategorySelect = document.getElementById("rank-category");
const rankResetBtn = document.getElementById("rank-reset");
const rankSlidersEl = document.getElementById("rank-sliders");
const rankTableEl = document.getElementById("rank-table");
const btRecipientsEl = document.getElementById("bt-recipients");
const btResistsEl = document.getElementById("bt-resists");
const btSummaryEl = document.getElementById("bt-summary");
const btListEl = document.getElementById("bt-list");
const btExcludedEl = document.getElementById("bt-excluded");
const tabPanels = {
  loadouts: document.getElementById("loadouts-view"),
  bufftemplate: document.getElementById("bufftemplate-view"),
  grid: document.getElementById("grid-view"),
  board: document.getElementById("board-view"),
  matrix: document.getElementById("matrix-view"),
  focus: document.getElementById("focus-view"),
  comparison: document.getElementById("comparison-view"),
  ranklab: document.getElementById("ranklab-view"),
};

// Tabs that own the whole viewport: the page itself stops scrolling, the header compacts, and the
// width cap comes off (see body.viewport-mode in index.html). The three grid explorations, for now.
const VIEWPORT_TABS = new Set(["board", "matrix", "focus"]);

// The controls stay put at the top of the page, so everything else that sticks (the grid's own
// table header, the Rank Lab sliders) has to start below them - publish the bar's live height as
// --topbar-h for those rules. In viewport-mode the bar isn't sticky at all, so the offset is 0.
const topbarEl = document.querySelector(".topbar");
function syncTopbarHeight() {
  const h = document.body.classList.contains("viewport-mode") ? 0 : topbarEl.offsetHeight;
  document.documentElement.style.setProperty("--topbar-h", `${h}px`);
}
new ResizeObserver(syncTopbarHeight).observe(topbarEl);

// Session-only working copy of the group weights - sliders mutate this
// directly; "Reset weights" restores the current archetype's slice from
// DEFAULT_GROUP_WEIGHTS (rank.js). Not persisted across reloads.
const rankGroupWeights = cloneGroupWeights();

let activeTab = "loadouts";

// Color follows the SLOT, not the class: whoever is in Class 1 is always blue, Class 2 amber,
// Class 3 rose - the same three colors every session, matching the Class 1/2/3 labels above the
// selects. A per-class palette (what this used to be) can't do that job: EQ's classes cluster by
// archetype, so a Cleric and a Shaman - both priests - came out nearly the same gold and the
// color told you nothing about which of YOUR picks a spell belonged to.
//
// The triad is validated, not eyeballed: OKLCH L 0.655 / C 0.15 at hues 255/62/350, which clears
// the lightness band, the chroma floor, WCAG 3:1 against the panel, and - the point of the
// exercise - stays separable under simulated color blindness (worst all-pairs OKLab ΔE 12.2
// protan/deutan, 17.6 normal vision). Changing a value here means re-running that check.
const SLOT_COLORS = ["#4b92ea", "#d07803", "#d2669d"];

// Class name -> slot color, rebuilt whenever the selection changes (see render). Classes you
// haven't picked - the other dozen in a tooltip's class roster - stay muted, so "which of these
// is mine" is answerable at a glance.
let slotColorByClass = new Map();

function syncSlotColors(classes) {
  slotColorByClass = new Map(classes.map((name, i) => [name, SLOT_COLORS[i % SLOT_COLORS.length]]));
}

function classColor(name) {
  return slotColorByClass.get(name) || "var(--muted)";
}

// Colored class "pill". Pass a level to append a muted "Lv N" inside the pill.
function classPill(name, level) {
  const lv = level != null ? ` <span class="class-pill-lv">Lv ${level}</span>` : "";
  return `<span class="class-pill" style="--pc:${classColor(name)}">${name}${lv}</span>`;
}

function populateClassSelects() {
  const archetypes = [...new Set(CLASSES.map((c) => c.archetype))];
  for (const select of classSelects) {
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "(none)";
    select.appendChild(none);

    for (const archetype of archetypes) {
      const group = document.createElement("optgroup");
      group.label = archetype;
      for (const c of CLASSES.filter((c) => c.archetype === archetype)) {
        const opt = document.createElement("option");
        opt.value = c.name;
        opt.textContent = `${c.name} (${c.code})`;
        group.appendChild(opt);
      }
      select.appendChild(group);
    }
  }
}

function populateRankControls() {
  for (const [id, label] of Object.entries(ARCHETYPES)) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = label;
    rankArchetypeSelect.appendChild(opt);
  }
  for (const category of Object.keys(CATEGORIES).sort()) {
    const opt = document.createElement("option");
    opt.value = category;
    opt.textContent = category;
    rankCategorySelect.appendChild(opt);
  }
  rankCategorySelect.value = "Buff";
}

function selectedClasses() {
  return classSelects.map((s) => s.value).filter(Boolean);
}

function applyStateFromQuery() {
  const params = new URLSearchParams(window.location.search);
  classSelects.forEach((select, i) => {
    const value = params.get(`c${i + 1}`);
    if (value && [...select.options].some((o) => o.value === value)) {
      select.value = value;
    }
  });
  const level = parseInt(params.get("lvl"), 10);
  if (!isNaN(level)) levelInput.value = level;

  const slots = parseInt(params.get("slots"), 10);
  if (!isNaN(slots)) slotsInput.value = slots;

  const tab = params.get("tab");
  if (tab && tabPanels[tab]) activeTab = tab;
}

function syncStateToQuery() {
  const params = new URLSearchParams();
  classSelects.forEach((select, i) => {
    if (select.value) params.set(`c${i + 1}`, select.value);
  });
  params.set("lvl", levelInput.value);
  params.set("slots", slotsInput.value);
  if (recipientStateInitialized) {
    const enabled = TEMPLATE_ROLE_ORDER.filter((r) => recipientState[r].enabled);
    params.set("r", enabled.join(","));
  }
  if (resistStateInitialized) {
    params.set("res", RESIST_ELEMENTS.filter((r) => resistState[r.id]).map((r) => r.id).join(","));
  }
  params.set("tab", activeTab);
  history.replaceState(null, "", "?" + params.toString());
}

function formatEffect(spell) {
  if (spell.primary_value == null) return "—";
  const stat = spell.primary_stat || "";
  if (spell.category === "Heal-HoT") {
    return `${spell.primary_value}/tick → ${spell.total_effect} total`;
  }
  return `${spell.total_effect ?? spell.primary_value} ${stat}`.trim();
}

function iconImg(spell) {
  return spell.icon
    ? `<img class="spell-icon" src="${spell.icon}" alt="" width="32" height="32" data-spell="${spell.spell_id}">`
    : `<span class="spell-icon spell-icon-placeholder" data-spell="${spell.spell_id}"></span>`;
}

// The spell's line (client Category › Subcategory, from the game's own hover taxonomy). This is
// the organizing thread of the tool: buffs sharing a line don't stack, and it's the game's own
// label for "what kind of spell this is". Rendered as a muted chip wherever a spell is shown.
function lineChip(spell) {
  if (!spell.line) return "";
  const title = spell.line_category === spell.line
    ? "Spell line (from the game client)"
    : `Spell line: ${spell.line} — the game client's own hover category`;
  return `<span class="line-chip" title="${title}">${spell.line}</span>`;
}

function spellCard(className, spell) {
  const eff = spell.mana_efficiency != null ? spell.mana_efficiency.toFixed(2) : "—";
  return `
    <div class="spell-card">
      <div class="spell-card-header">
        ${iconImg(spell)}
        ${classPill(className)}
        <span class="spell-name" data-spell="${spell.spell_id}">${spell.name}</span>
        <span class="spell-level">Lv ${spell.level}</span>
        ${lineChip(spell)}
      </div>
      <div class="spell-stats">
        <div><label>Mana</label><span>${spell.mana}</span></div>
        <div><label>Duration</label><span>${spell.duration}</span></div>
        <div><label>Effect</label><span>${formatEffect(spell)}</span></div>
        <div><label>Efficiency</label><span>${eff} /mana</span></div>
      </div>
      <div class="spell-desc">${spell.description}</div>
    </div>`;
}

function renderOverlapping(overlapping) {
  if (overlapping.length === 0) {
    return `<p class="empty">No overlapping spell categories between the selected classes at this level.</p>`;
  }
  return overlapping
    .map(({ category, entries }) => {
      const cards = entries.map(({ className, spell }) => spellCard(className, spell)).join("");
      return `
        <section class="category-block">
          <h3>${category} <span class="category-desc">${CATEGORIES[category] || ""}</span></h3>
          <div class="spell-card-row">${cards}</div>
        </section>`;
    })
    .join("");
}

function renderUnique(unique) {
  if (unique.length === 0) return "";
  const rows = unique
    .map(
      ({ category, entry }) =>
        `<li><strong>${category}</strong> — only ${classPill(entry.className)} (${entry.spell.name}, Lv ${entry.spell.level})</li>`
    )
    .join("");
  return `
    <details class="unique-block">
      <summary>Categories only one selected class currently has (${unique.length})</summary>
      <ul>${rows}</ul>
    </details>`;
}

function renderComparison(classes, level) {
  if (classes.length === 0) {
    resultsEl.innerHTML = `<p class="empty">Pick 1-3 classes above to compare their spells.</p>`;
    return;
  }
  const { overlapping, unique } = compareClasses(classes, level);
  resultsEl.innerHTML = renderOverlapping(overlapping) + renderUnique(unique);
}

// Element/resist palette for the type chips: Fire warm, Cold icy, Magic violet, Poison green,
// Disease sickly olive, Chromatic (resisted by lowest resist) a neutral lavender.
const ELEMENT_COLORS = {
  Fire: "#e8804f",
  Cold: "#6fb8e8",
  Magic: "#b98cf2",
  Poison: "#7fc86a",
  Disease: "#b0a060",
  Chromatic: "#c98fd0",
};

function elementChip(resistType) {
  if (!resistType) return "";
  const c = ELEMENT_COLORS[resistType] || "var(--muted)";
  return `<span class="element-chip" style="--ec:${c}">${resistType}</span>`;
}

const CLASS_CODE = Object.fromEntries(CLASSES.map((c) => [c.name, c.code]));
function classCode(name) {
  return CLASS_CODE[name] || name.slice(0, 3).toUpperCase();
}

// One table row per spell line: Line (the client subcategory) | Best spell | Effect | Class |
// same-line/alternatives. The parent Category is the section header, so the row only needs the
// subcategory. Damage/resist subcategories (Fire, Cold, ...) get their element color chip.
// Nothing is truncated - cells wrap so the text flows.
// `showLabel` is false for the 2nd+ row of a collection line (illusions), so a run of variants
// reads as one grouped block under a single subcategory label instead of repeating it every row.
function gridTableRow(row, showLabel = true) {
  const { subcategory, best, runnersUp, conflict } = row;
  const spell = best.spell;
  const element = ELEMENT_COLORS[subcategory] ? subcategory : null;
  const chip = element ? elementChip(element) : "";
  const warn = conflict && runnersUp.length ? ` <span class="gt-warn" title="Only the strongest of these takes effect">▲</span>` : "";
  const pills = best.classLevels.map((cl) => classPill(cl.class, cl.level)).join("");
  const others = runnersUp
    .map((e) => `<span class="gt-other">${e.classLevels.map((c) => classCode(c.class)).join("/")} ${e.spell.name}</span>`)
    .join(", ");
  const label = showLabel ? `${subcategory || "General"}${chip}` : "";
  return `
    <tr class="${conflict ? "gt-conflict" : ""}">
      <td class="gtc-type">${label}</td>
      <td class="gtc-best">${iconImg(spell)}<span class="spell-name" data-spell="${spell.spell_id}">${spell.name}</span>${warn}</td>
      <td class="gtc-eff">${formatEffect(spell)}</td>
      <td class="gtc-class"><span class="class-pill-group">${pills}</span></td>
      <td class="gtc-others" title="${spell.mana} mana · ${spell.duration}">${others}</td>
    </tr>`;
}

// The board's sections ARE the client's own parent spell Categories, listed alphabetically (as are
// the line rows within each). A short gloss demystifies the broad "Utility *" buckets that carry
// the game's own (slightly opaque) names.
const LINE_SECTION_GLOSS = {
  "Utility Detrimental": "debuffs · crowd control",
  "Utility Beneficial": "haste · shields · movement · utility",
  "Taps": "lifetaps",
  "Regen": "HP / mana regen",
  "Create Item": "summoned items",
};

function renderGrid(classes, level) {
  if (classes.length === 0) {
    gridTableEl.innerHTML = `<p class="empty">Pick 1-3 classes above to see the best spell for each line.</p>`;
    return;
  }
  const rows = spellLineGrid(classes, level);
  if (rows.length === 0) {
    gridTableEl.innerHTML = `<p class="empty">No spells available for these classes at this level.</p>`;
    return;
  }
  const bySection = new Map(); // client parent Category -> its line rows
  for (const row of rows) {
    if (!bySection.has(row.category)) bySection.set(row.category, []);
    bySection.get(row.category).push(row);
  }
  const ordered = [...bySection.keys()].sort((a, b) => a.localeCompare(b));
  // One plain table: a full-width header row introduces each client Category, then a row per line
  // within it (alpha by subcategory). Buff/HoT lines that don't stack are marked with a ▲.
  const body = ordered
    .map((cat) => {
      // Alpha by subcategory, then by name so a collection line's variants (which share a
      // subcategory) come out alphabetized among themselves.
      const secRows = bySection.get(cat).sort(
        (a, b) =>
          (a.subcategory || "").localeCompare(b.subcategory || "") ||
          a.best.spell.name.localeCompare(b.best.spell.name)
      );
      const gloss = LINE_SECTION_GLOSS[cat] ? ` <span class="grid-section-gloss">${LINE_SECTION_GLOSS[cat]}</span>` : "";
      const header = `<tr class="grid-section-row"><td colspan="5">${cat}${gloss} <span class="grid-section-count">${secRows.length}</span></td></tr>`;
      let prevSub = null;
      const secBody = secRows
        .map((r) => {
          const showLabel = r.subcategory !== prevSub;
          prevSub = r.subcategory;
          return gridTableRow(r, showLabel);
        })
        .join("");
      return header + secBody;
    })
    .join("");
  gridTableEl.innerHTML = `
    <table class="grid-table">
      <thead>
        <tr><th>Line</th><th>Best in slot</th><th>Effect</th><th>Class</th><th>Won't stack with · alternatives</th></tr>
      </thead>
      <tbody>${body}</tbody>
    </table>`;
}

function loadoutRow(index, slotBudget, className, spell, statLabel, subText, badge = "") {
  const overBudget = index >= slotBudget;
  return `
    <div class="loadout-row ${overBudget ? "over-budget" : ""}">
      <span class="loadout-rank">${index + 1}</span>
      ${iconImg(spell)}
      <div class="loadout-main">
        ${classPill(className)}
        <span class="spell-name" data-spell="${spell.spell_id}">${spell.name}</span>${badge}
        <span class="spell-level">Lv ${spell.level}</span>
        ${lineChip(spell)}
        <div class="spell-desc">${spell.description}</div>
      </div>
      <div class="loadout-stat">
        ${statLabel}
        <span class="loadout-sub">${subText}</span>
      </div>
    </div>`;
}

function withBudgetDivider(rows, slotBudget) {
  if (slotBudget >= rows.length || slotBudget < 1) return rows.join("");
  const divider = `<div class="budget-divider">beyond your ${slotBudget}-slot budget</div>`;
  return rows.slice(0, slotBudget).join("") + divider + rows.slice(slotBudget).join("");
}

function updateSlotMeter(el, count, slotBudget) {
  el.textContent = `${count} / ${slotBudget} slots`;
  el.classList.toggle("over", count > slotBudget);
}

function renderBuffLoadout(classes, level, slotBudget) {
  if (classes.length === 0) {
    buffLoadoutEl.innerHTML = `<p class="empty">Pick 1-3 classes above.</p>`;
    buffSlotMeterEl.textContent = "";
    return;
  }
  const picks = buffLoadout(classes, level);
  updateSlotMeter(buffSlotMeterEl, picks.length, slotBudget);
  if (picks.length === 0) {
    buffLoadoutEl.innerHTML = `<p class="empty">No buffs available for these classes at this level.</p>`;
    return;
  }
  const rows = picks.map((spell, i) => {
    const stat = spell.primary_value != null
      ? `${spell.primary_value}${spell.primary_stat ? " " + spell.primary_stat : ""}`
      : "—";
    const subText = `${spell.mana} mana · ${spell.duration}`;
    const badge = spell.confirmed
      ? ""
      : ` <span class="unconfirmed-badge" title="This spell has no line in the game client's spell data — shown assuming it doesn't conflict with anything else.">?</span>`;
    return loadoutRow(i, slotBudget, spell.class, spell, stat, subText, badge);
  });
  buffLoadoutEl.innerHTML = withBudgetDivider(rows, slotBudget);
}

function renderRankSliders() {
  const archetype = rankArchetypeSelect.value;
  const weights = rankGroupWeights[archetype];
  rankSlidersEl.innerHTML = GROUP_ORDER.map((group) => `
    <div class="rank-slider-field">
      <label for="rank-slider-${group}">
        ${GROUP_LABELS[group]}
        <span class="rank-slider-value" id="rank-slider-value-${group}">${weights[group].toFixed(1)}</span>
      </label>
      <input type="range" id="rank-slider-${group}" min="0" max="5" step="0.1" value="${weights[group]}">
    </div>`).join("");

  for (const group of GROUP_ORDER) {
    const input = document.getElementById(`rank-slider-${group}`);
    const valueEl = document.getElementById(`rank-slider-value-${group}`);
    input.addEventListener("input", () => {
      const value = parseFloat(input.value);
      rankGroupWeights[archetype][group] = value;
      valueEl.textContent = value.toFixed(1);
      renderRankTable();
    });
  }
}

function rankBreakdownText(breakdown) {
  return breakdown
    .map(({ stat, value, weight, points }) => `${stat} ${value > 0 ? "+" : ""}${value}×${weight}=${points.toFixed(1)}`)
    .join(", ");
}

function renderRankTable() {
  const classes = selectedClasses();
  const level = parseInt(levelInput.value, 10) || 1;
  const archetype = rankArchetypeSelect.value;
  const category = rankCategorySelect.value;

  if (classes.length === 0) {
    rankTableEl.innerHTML = `<tr><td class="grid-cell-empty">Pick 1-3 classes above to rank their spells.</td></tr>`;
    return;
  }

  const ranked = rankSpells(classes, level, category, archetype, rankGroupWeights);
  if (ranked.length === 0) {
    rankTableEl.innerHTML = `<tr><td class="grid-cell-empty">No ${category} spells for these classes at this level.</td></tr>`;
    return;
  }

  const header = `<thead><tr><th>#</th><th></th><th>Class</th><th>Spell</th><th>Description</th><th>Target</th><th>Line</th><th>Score</th><th>Breakdown</th></tr></thead>`;
  const rows = ranked
    .map(
      ({ spell, classLevels, score, breakdown, slot }, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${iconImg(spell)}</td>
          <td class="rank-classes"><span class="class-pill-group">${classLevels
            .map((cl) => classPill(cl.class, cl.level))
            .join("")}</span></td>
          <td><span class="spell-name" data-spell="${spell.spell_id}">${spell.name}</span></td>
          <td class="rank-description">${spell.description || "—"}</td>
          <td>${spell.target || "—"}</td>
          <td class="rank-slot">${slot}</td>
          <td class="rank-score">${score.toFixed(1)}</td>
          <td class="rank-breakdown">${rankBreakdownText(breakdown)}</td>
        </tr>`
    )
    .join("");
  rankTableEl.innerHTML = header + `<tbody>${rows}</tbody>`;
}

// --- Quick Buff template panel: recipient state + rendering --------------------------

// Who the buff template is for. Enabled roles and their importance drive templateScore()
// in rank.js. Pets defaults on only when the trio can actually field a pet (data-driven).
const recipientState = {};
let recipientStateInitialized = false;

// Which resist elements the user wants folded into the template. Ordered fire/cold/magic
// first (the common ones), then poison/disease. Defaults to all on = today's behavior.
const RESIST_ELEMENTS = [
  { id: "fire", label: "Fire" },
  { id: "cold", label: "Cold" },
  { id: "magic", label: "Magic" },
  { id: "poison", label: "Poison" },
  { id: "disease", label: "Disease" },
];
const resistState = {};
let resistStateInitialized = false;

function initResistState() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("res"); // "" (all off) is distinct from absent (default all on)
  const enabledSet = fromUrl != null ? new Set(fromUrl.split(",").filter(Boolean)) : null;
  for (const { id } of RESIST_ELEMENTS) {
    resistState[id] = enabledSet ? enabledSet.has(id) : true;
  }
  resistStateInitialized = true;
}

function selectedResists() {
  if (!resistStateInitialized) initResistState();
  return new Set(RESIST_ELEMENTS.filter((r) => resistState[r.id]).map((r) => r.id));
}

function renderResistControls() {
  if (!resistStateInitialized) initResistState();
  btResistsEl.innerHTML =
    `<span class="bt-resists-label">Resists in template</span>` +
    RESIST_ELEMENTS.map(
      (r) => `
      <label class="bt-resist-toggle">
        <input type="checkbox" id="resist-${r.id}" ${resistState[r.id] ? "checked" : ""}>
        ${r.label}
      </label>`
    ).join("");

  for (const { id } of RESIST_ELEMENTS) {
    document.getElementById(`resist-${id}`).addEventListener("change", (e) => {
      resistState[id] = e.target.checked;
      syncStateToQuery();
      renderBuffTemplate();
    });
  }
}

function trioHasPets(classes, level) {
  return SPELLS.some(
    (s) => s.category === "Pet/Summon" && classes.includes(s.class) && s.level <= level &&
           (s.spas || []).some((spa) => [33, 71, 103, 106].includes(spa))
  );
}

function initRecipientState() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("r");
  const enabledSet = fromUrl ? new Set(fromUrl.split(",")) : null;
  for (const role of TEMPLATE_ROLE_ORDER) {
    const defaultOn = role === "pets"
      ? trioHasPets(selectedClasses(), parseInt(levelInput.value, 10) || 1)
      : true;
    recipientState[role] = {
      enabled: enabledSet ? enabledSet.has(role) : defaultOn,
      importance: 1.0,
    };
  }
  recipientStateInitialized = true;
}

// What each recipient card says it values - shown on the card so toggling it teaches the
// scoring model instead of feeling like a mystery knob.
const RECIPIENT_CAPTIONS = {
  self: "Your own body — self-only buffs (Shielding line, skins, stances)",
  tank: "AC · Max HP · damage shields · HP regen",
  melee: "Haste · ATK · STR/DEX · weapon procs",
  caster: "Mana regen (Clarity line) · runes",
  healer: "Mana regen · WIS",
  pets: "Pet haste (Burnout line) · pet damage shields",
};

function renderRecipientControls() {
  if (!recipientStateInitialized) initRecipientState();
  btRecipientsEl.innerHTML = TEMPLATE_ROLE_ORDER.map((role) => {
    const st = recipientState[role];
    return `
      <div class="bt-recipient-card ${st.enabled ? "" : "recipient-off"}">
        <label>
          <input type="checkbox" id="recip-${role}" ${st.enabled ? "checked" : ""}>
          ${TEMPLATE_ROLE_LABELS[role]}
          <span class="rank-slider-value" id="recip-w-value-${role}">×${st.importance.toFixed(1)}</span>
        </label>
        <span class="bt-recipient-caption">${RECIPIENT_CAPTIONS[role]}</span>
        <input type="range" id="recip-w-${role}" min="0" max="3" step="0.1" value="${st.importance}"
               ${st.enabled ? "" : "disabled"} title="How much buffing this recipient matters to you">
      </div>`;
  }).join("");

  for (const role of TEMPLATE_ROLE_ORDER) {
    document.getElementById(`recip-${role}`).addEventListener("change", (e) => {
      recipientState[role].enabled = e.target.checked;
      syncStateToQuery();
      renderRecipientControls();
      renderBuffTemplate();
    });
    const slider = document.getElementById(`recip-w-${role}`);
    slider.addEventListener("input", () => {
      recipientState[role].importance = parseFloat(slider.value);
      document.getElementById(`recip-w-value-${role}`).textContent = `×${recipientState[role].importance.toFixed(1)}`;
      renderBuffTemplate();
    });
  }
}

function targetChip(spell) {
  if (spell.target === "Self") return `<span class="bt-chip bt-chip-self">Self</span>`;
  if (spell.target === "Pet") return `<span class="bt-chip bt-chip-pet">Pet</span>`;
  if ((spell.target || "").includes("Group")) return `<span class="bt-chip bt-chip-group">Group</span>`;
  return `<span class="bt-chip">Single</span>`;
}

function buffTemplateRow(index, slotBudget, pick) {
  const { spell, classLevels, score, confirmed } = pick;
  const overBudget = index >= slotBudget;
  const classText = `<span class="class-pill-group">${classLevels
    .map((cl) => classPill(cl.class, cl.level))
    .join("")}</span>`;
  const lineText = confirmed
    ? spell.stacking_groups.map((g) => g.label).join(" + ")
    : "stacking unconfirmed";
  const badge = confirmed
    ? ""
    : ` <span class="unconfirmed-badge" title="No confirmed stacking data for this spell — shown assuming it doesn't conflict with anything else.">?</span>`;
  return `
    <div class="bt-row ${overBudget ? "over-budget" : ""}">
      <span class="bt-rank">${index + 1}</span>
      ${iconImg(spell)}
      <div class="bt-main">
        <div class="bt-title">
          <span class="spell-name" data-spell="${spell.spell_id}">${spell.name}</span>${badge}
          ${targetChip(spell)}
        </div>
        <div class="bt-meta">${classText} · claims: ${lineText}</div>
        <div class="rank-why">${pick.why}</div>
      </div>
      <div class="bt-score">${score.toFixed(0)}</div>
    </div>`;
}

function renderBuffTemplateExcluded(excluded) {
  if (excluded.length === 0) {
    btExcludedEl.innerHTML = "";
    return;
  }
  const byKey = new Map();
  for (const entry of excluded) {
    const key = entry.reason.key;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(entry);
  }
  const groups = [...byKey.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([key, entries]) => {
      const names = entries
        .sort((a, b) => a.spell.name.localeCompare(b.spell.name))
        .map(({ spell, reason }) => `<span title="${reason.text}">${spell.name}</span>`)
        .join(", ");
      return `
        <div class="bt-excl-group">
          <span class="bt-excl-reason">${EXCLUSION_GROUP_LABELS[key] || key} (${entries.length})</span>
          <span class="bt-excl-names">${names}</span>
        </div>`;
    })
    .join("");
  btExcludedEl.innerHTML = `
    <details class="bt-excluded-block">
      <summary>Excluded from the template (${excluded.length}) — audit why</summary>
      ${groups}
    </details>`;
}

function renderBuffTemplate() {
  const classes = selectedClasses();
  const level = parseInt(levelInput.value, 10) || 1;
  const slotBudget = parseInt(slotsInput.value, 10) || 1;

  if (!recipientStateInitialized) initRecipientState();
  if (classes.length === 0) {
    btSummaryEl.innerHTML = "";
    btListEl.innerHTML = `<p class="empty">Pick 1-3 classes above to build your Quick Buff template.</p>`;
    btExcludedEl.innerHTML = "";
    return;
  }
  const { picks, excluded } = suggestedBuffTemplate(classes, level, recipientState, selectedResists());
  if (picks.length === 0) {
    btSummaryEl.innerHTML = "";
    btListEl.innerHTML = `<p class="empty">No template-worthy buffs for these classes/recipients at this level.</p>`;
    renderBuffTemplateExcluded(excluded);
    return;
  }
  const fits = Math.min(picks.length, slotBudget);
  const overflow = picks.length - fits;
  btSummaryEl.innerHTML =
    `<strong>${picks.length}</strong> buffs cover every stacking line worth claiming — ` +
    `<strong>${fits}</strong> fit your ${slotBudget}-slot budget` +
    (overflow > 0 ? `, ${overflow} spill past it (dimmed below)` : "") +
    ` · ${excluded.length} spells excluded`;
  btListEl.innerHTML = withBudgetDivider(picks.map((p, i) => buffTemplateRow(i, slotBudget, p)), slotBudget);
  renderBuffTemplateExcluded(excluded);
}

function setActiveTab(tab) {
  activeTab = tab;
  tabButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tab));
  Object.entries(tabPanels).forEach(([id, el]) => el.classList.toggle("active", id === tab));
  document.body.classList.toggle("viewport-mode", VIEWPORT_TABS.has(tab));
  syncTopbarHeight();
}

function render() {
  const classes = selectedClasses();
  const level = parseInt(levelInput.value, 10) || 1;
  const slotBudget = parseInt(slotsInput.value, 10) || 1;

  syncSlotColors(classes); // every pill/chip below reads this - set it before anything renders
  syncStateToQuery();
  setActiveTab(activeTab);

  renderBuffLoadout(classes, level, slotBudget);
  renderGrid(classes, level);
  renderBoard(classes, level);
  renderMatrix(classes, level);
  renderFocus(classes, level);
  renderComparison(classes, level);
  renderRankTable();
  renderBuffTemplate();
}

populateClassSelects();
populateRankControls();
applyStateFromQuery();
setActiveTab(activeTab);
renderRankSliders();
renderRecipientControls();
renderResistControls();

classSelects.forEach((s) => s.addEventListener("change", render));
levelInput.addEventListener("input", render);
slotsInput.addEventListener("input", render);
tabButtons.forEach((btn) => btn.addEventListener("click", () => { setActiveTab(btn.dataset.tab); syncStateToQuery(); }));
// The suggested-buff panel runs on recipient roles, not the caster archetype - only the
// ranking table needs re-rendering when archetype sliders move.
rankArchetypeSelect.addEventListener("change", () => { renderRankSliders(); renderRankTable(); });
rankCategorySelect.addEventListener("change", renderRankTable);
rankResetBtn.addEventListener("click", () => {
  const archetype = rankArchetypeSelect.value;
  rankGroupWeights[archetype] = { ...DEFAULT_GROUP_WEIGHTS[archetype] };
  renderRankSliders();
  renderRankTable();
});

render();
