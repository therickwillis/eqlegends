const classSelects = [
  document.getElementById("class1"),
  document.getElementById("class2"),
  document.getElementById("class3"),
];
const levelInput = document.getElementById("level");
const slotsInput = document.getElementById("slots");
const rolesContainer = document.getElementById("roles");
const resultsEl = document.getElementById("results");
const buffLoadoutEl = document.getElementById("buff-loadout");
const roleLoadoutEl = document.getElementById("role-loadout");
const buffSlotMeterEl = document.getElementById("buff-slot-meter");
const roleSlotMeterEl = document.getElementById("role-slot-meter");
const tabButtons = [...document.querySelectorAll(".tab-btn")];
const tabPanels = {
  loadouts: document.getElementById("loadouts-view"),
  comparison: document.getElementById("comparison-view"),
};

let activeTab = "loadouts";

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

function populateRoleCheckboxes() {
  for (const [id, def] of Object.entries(ROLE_DEFINITIONS)) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = id;
    input.id = `role-${id}`;
    label.appendChild(input);
    label.appendChild(document.createTextNode(def.label));
    rolesContainer.appendChild(label);
  }
}

function selectedClasses() {
  return classSelects.map((s) => s.value).filter(Boolean);
}

function selectedRoles() {
  return [...rolesContainer.querySelectorAll("input:checked")].map((el) => el.value);
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

  const roles = (params.get("roles") || "").split(",").filter(Boolean);
  if (roles.length) {
    roles.forEach((id) => {
      const cb = document.getElementById(`role-${id}`);
      if (cb) cb.checked = true;
    });
  }

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
  const roles = selectedRoles();
  if (roles.length) params.set("roles", roles.join(","));
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
    ? `<img class="spell-icon" src="${spell.icon}" alt="" width="32" height="32">`
    : `<span class="spell-icon spell-icon-placeholder"></span>`;
}

function spellCard(className, spell) {
  const eff = spell.mana_efficiency != null ? spell.mana_efficiency.toFixed(2) : "—";
  return `
    <div class="spell-card">
      <div class="spell-card-header">
        ${iconImg(spell)}
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

function renderComparison(classes, level) {
  if (classes.length === 0) {
    resultsEl.innerHTML = `<p class="empty">Pick 1-3 classes above to compare their spells.</p>`;
    return;
  }
  const { overlapping, unique } = compareClasses(classes, level);
  resultsEl.innerHTML = renderOverlapping(overlapping) + renderUnique(unique);
}

function loadoutRow(index, slotBudget, className, spell, statLabel, subText, badge = "") {
  const overBudget = index >= slotBudget;
  return `
    <div class="loadout-row ${overBudget ? "over-budget" : ""}">
      <span class="loadout-rank">${index + 1}</span>
      ${iconImg(spell)}
      <div class="loadout-main">
        <span class="class-name">${className}</span>
        <span class="spell-name">${spell.name}</span>${badge}
        <span class="spell-level">Lv ${spell.level}</span>
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
    const subText = spell.confirmed
      ? spell.stacking_groups.map((g) => g.label).join(" + ")
      : "stacking unconfirmed";
    const badge = spell.confirmed
      ? ""
      : ` <span class="unconfirmed-badge" title="No confirmed stacking data for this spell (not found on eqlwiki.com's Buff Lines page) — shown assuming it doesn't conflict with anything else.">?</span>`;
    return loadoutRow(i, slotBudget, spell.class, spell, stat, subText, badge);
  });
  buffLoadoutEl.innerHTML = withBudgetDivider(rows, slotBudget);
}

function renderRoleLoadout(classes, level, slotBudget, roles) {
  if (classes.length === 0) {
    roleLoadoutEl.innerHTML = `<p class="empty">Pick 1-3 classes above.</p>`;
    roleSlotMeterEl.textContent = "";
    return;
  }
  if (roles.length === 0) {
    roleLoadoutEl.innerHTML = `<p class="empty">Check one or more roles above to see recommendations.</p>`;
    roleSlotMeterEl.textContent = "";
    return;
  }
  const picks = roleLoadout(classes, level, roles);
  updateSlotMeter(roleSlotMeterEl, picks.length, slotBudget);
  if (picks.length === 0) {
    roleLoadoutEl.innerHTML = `<p class="empty">No spells available for these roles/classes at this level.</p>`;
    return;
  }
  const rows = picks.map((spell, i) => {
    const stat = formatEffect(spell);
    const subText = `${spell.mana} mana · ${spell.duration}`;
    return loadoutRow(i, slotBudget, spell.class, spell, `${spell.category} · ${stat}`, subText);
  });
  roleLoadoutEl.innerHTML = withBudgetDivider(rows, slotBudget);
}

function setActiveTab(tab) {
  activeTab = tab;
  tabButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tab));
  Object.entries(tabPanels).forEach(([id, el]) => el.classList.toggle("active", id === tab));
}

function render() {
  const classes = selectedClasses();
  const level = parseInt(levelInput.value, 10) || 1;
  const slotBudget = parseInt(slotsInput.value, 10) || 1;
  const roles = selectedRoles();

  syncStateToQuery();
  setActiveTab(activeTab);

  renderBuffLoadout(classes, level, slotBudget);
  renderRoleLoadout(classes, level, slotBudget, roles);
  renderComparison(classes, level);
}

populateClassSelects();
populateRoleCheckboxes();
applyStateFromQuery();
setActiveTab(activeTab);

classSelects.forEach((s) => s.addEventListener("change", render));
levelInput.addEventListener("input", render);
slotsInput.addEventListener("input", render);
rolesContainer.addEventListener("change", render);
tabButtons.forEach((btn) => btn.addEventListener("click", () => { setActiveTab(btn.dataset.tab); syncStateToQuery(); }));

render();
