const classSelects = [
  document.getElementById("class1"),
  document.getElementById("class2"),
  document.getElementById("class3"),
];
const levelInput = document.getElementById("level");
const resultsEl = document.getElementById("results");

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
  if (!isNaN(level)) {
    levelInput.value = level;
  }
}

function syncStateToQuery() {
  const params = new URLSearchParams();
  classSelects.forEach((select, i) => {
    if (select.value) params.set(`c${i + 1}`, select.value);
  });
  params.set("lvl", levelInput.value);
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

function spellCard(className, spell) {
  const eff = spell.mana_efficiency != null ? spell.mana_efficiency.toFixed(2) : "—";
  const icon = spell.icon
    ? `<img class="spell-icon" src="${spell.icon}" alt="" width="32" height="32">`
    : `<span class="spell-icon spell-icon-placeholder"></span>`;
  return `
    <div class="spell-card">
      <div class="spell-card-header">
        ${icon}
        <span class="class-name">${className}</span>
        <span class="spell-name">${spell.name}</span>
        <span class="spell-level">Lv ${spell.level}</span>
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
        `<li><strong>${category}</strong> — only ${entry.className} (${entry.spell.name}, Lv ${entry.spell.level})</li>`
    )
    .join("");
  return `
    <details class="unique-block">
      <summary>Categories only one selected class currently has (${unique.length})</summary>
      <ul>${rows}</ul>
    </details>`;
}

function render() {
  syncStateToQuery();

  const classes = selectedClasses();
  const level = parseInt(levelInput.value, 10) || 1;

  if (classes.length === 0) {
    resultsEl.innerHTML = `<p class="empty">Pick 1-3 classes above to compare their spells.</p>`;
    return;
  }

  const { overlapping, unique } = compareClasses(classes, level);
  resultsEl.innerHTML = renderOverlapping(overlapping) + renderUnique(unique);
}

populateClassSelects();
applyStateFromQuery();
classSelects.forEach((s) => s.addEventListener("change", render));
levelInput.addEventListener("input", render);
render();
