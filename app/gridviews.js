// Viewport-fit explorations of the Category Grid — three alternative renderings of the same
// spellLineGrid() data (compare.js), each trying a different answer to "get the whole board on
// one screen without scrolling":
//
//   A · Board   newspaper columns; every line visible at once, density adjustable.
//   B · Matrix  category x class; reads across ("who brings what") instead of down.
//   C · Focus   master/detail; a fixed category rail plus one category in full detail.
//
// They share app.js's presentation helpers (classColor/classPill/classCode/iconImg/formatEffect/
// elementChip/LINE_SECTION_GLOSS) — this file loads first, but only touches them at render time.
// Spell tooltips come for free: anything tagged data-spell is picked up by tooltip.js.

const boardBodyEl = document.getElementById("board-body");
const boardFilterEl = document.getElementById("board-filter");
const boardDensityEl = document.getElementById("board-density");
const boardCountEl = document.getElementById("board-count");
const matrixTableEl = document.getElementById("matrix-table");
const matrixCountEl = document.getElementById("matrix-count");
const focusRailEl = document.getElementById("focus-rail");
const focusDetailEl = document.getElementById("focus-detail");

// View state that outlives a re-render: density/filter for the Board, selected category for Focus.
// `gvLast` lets a toolbar control re-render its own view without going through app.js's render().
let boardDensity = "compact";
let boardFilter = "";
let focusCategory = null;
let gvLast = { classes: [], level: 1 };

const GV_EMPTY = `<p class="empty">Pick 1-3 classes above to see the board.</p>`;

// spellLineGrid()'s flat rows, grouped into the client's parent Categories (alphabetical, as are
// the lines inside each) — the same shape all three views walk.
function gvSections(classes, level) {
  const bySection = new Map();
  for (const row of spellLineGrid(classes, level)) {
    if (!bySection.has(row.category)) bySection.set(row.category, []);
    bySection.get(row.category).push(row);
  }
  return [...bySection.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([category, rows]) => ({
      category,
      gloss: LINE_SECTION_GLOSS[category] || "",
      rows: rows.sort(
        (a, b) =>
          (a.subcategory || "").localeCompare(b.subcategory || "") ||
          a.best.spell.name.localeCompare(b.best.spell.name)
      ),
    }));
}

// Free-text match across everything visible on a row, so "fire", "cleric" and "root" all work.
function gvMatches(row, q) {
  if (!q) return true;
  const hay = [
    row.category,
    row.subcategory,
    row.best.spell.name,
    ...row.best.classLevels.map((c) => c.class),
    ...row.runnersUp.map((e) => e.spell.name),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

// "Only the strongest of these stacks" — a real buff line with someone losing out.
function gvConflicted(row) {
  return row.conflict && row.runnersUp.length > 0;
}

const GV_WARN = `<span class="gt-warn" title="Buff line — only the strongest of these actually stacks">▲</span>`;

// ---------------------------------------------------------------------------------------------
// A · Board
// ---------------------------------------------------------------------------------------------

// Collection lines (illusions, visages) are one row per variant in the Category Grid — two dozen
// of them on an Enchanter, which is most of the board. Here they collapse to a single row per
// subcategory ("Illusion: Adventurer — 14 variants"); the full list lives in the hover title, and
// Focus/Category Grid still show every one. Non-collection rows pass through untouched.
function boardRows(rows) {
  const singles = [];
  const collections = new Map(); // subcategory -> its variant rows
  for (const row of rows) {
    if (!row.collection) {
      singles.push(row);
      continue;
    }
    if (!collections.has(row.subcategory)) collections.set(row.subcategory, []);
    collections.get(row.subcategory).push(row);
  }
  for (const group of collections.values()) {
    singles.push(group.length === 1 ? group[0] : { ...group[0], merged: group });
  }
  return singles.sort(
    (a, b) =>
      (a.subcategory || "").localeCompare(b.subcategory || "") ||
      a.best.spell.name.localeCompare(b.best.spell.name)
  );
}

// One row: line name | icon | spell | effect | who gets it. Everything past the spell name is
// squeezed to its content, and the name ellipsizes rather than wrapping — a row is always exactly
// one line tall, which is what makes the column count predictable enough to fit a screen.
function boardLine(row) {
  const spell = row.best.spell;
  const classes = row.merged
    ? [...new Map(row.merged.flatMap((r) => r.best.classLevels).map((cl) => [cl.class, cl])).values()]
    : row.best.classLevels;
  const codes = classes
    .map(
      (cl) =>
        `<i class="gv-code" style="--pc:${classColor(cl.class)}" title="${cl.class} — Lv ${cl.level}">${classCode(cl.class)}</i>`
    )
    .join("");
  const alts = row.runnersUp.length
    ? `<span class="bv-alts" title="${row.runnersUp
        .map((e) => `${e.classLevels.map((c) => classCode(c.class)).join("/")} ${e.spell.name}`)
        .join(", ")}">+${row.runnersUp.length}</span>`
    : "";
  const sub = row.subcategory || "General";
  // A merged collection row names its count instead of a winner - there isn't one.
  const name = row.merged
    ? `<span class="bv-name bv-name-many" title="${row.merged.map((r) => r.best.spell.name).join(", ")}">${row.merged.length} variants</span>`
    // No `title` here even though the name ellipsizes - this element raises the spell tooltip,
    // which leads with the full name. A native title would just fight it (see tooltip.js).
    : `<span class="bv-name" data-spell="${spell.spell_id}">${spell.name}</span>`;
  return `
    <li class="bv-line ${gvConflicted(row) ? "is-conflict" : ""}">
      <span class="bv-sub" title="${row.category} › ${sub}">${sub}</span>
      ${iconImg(spell)}
      ${name}${gvConflicted(row) ? GV_WARN : ""}
      <span class="bv-eff">${row.merged ? "" : formatEffect(spell)}</span>
      <span class="bv-codes">${codes}${alts}</span>
    </li>`;
}

function renderBoard(classes, level) {
  gvLast = { classes, level };
  if (classes.length === 0) {
    boardBodyEl.innerHTML = GV_EMPTY;
    boardCountEl.innerHTML = "";
    return;
  }
  const q = boardFilter.trim().toLowerCase();
  const sections = gvSections(classes, level)
    .map((s) => ({ ...s, rows: boardRows(s.rows.filter((r) => gvMatches(r, q))) }))
    .filter((s) => s.rows.length > 0);

  boardBodyEl.className = `bv-board dens-${boardDensity}`;
  if (sections.length === 0) {
    boardBodyEl.innerHTML = `<p class="empty">Nothing matches “${boardFilter}”.</p>`;
    boardCountEl.innerHTML = "";
    return;
  }
  boardBodyEl.innerHTML = sections
    .map(
      (s) => `
      <section class="bv-sec ${s.rows.length > 28 ? "bv-sec-tall" : ""}">
        <div class="bv-sec-head">
          <span>${s.category}</span>
          ${s.gloss ? `<span class="bv-sec-gloss">${s.gloss}</span>` : ""}
          <span class="bv-sec-n">${s.rows.length}</span>
        </div>
        <ul>${s.rows.map(boardLine).join("")}</ul>
      </section>`
    )
    .join("");

  const lines = sections.reduce((n, s) => n + s.rows.length, 0);
  const conflicts = sections.reduce((n, s) => n + s.rows.filter(gvConflicted).length, 0);
  boardCountEl.innerHTML =
    `<b>${lines}</b> lines · <b>${sections.length}</b> categories` +
    (conflicts ? ` · <b>${conflicts}</b> non-stacking` : "") +
    (q ? " · filtered" : "");
}

// ---------------------------------------------------------------------------------------------
// B · Matrix
// ---------------------------------------------------------------------------------------------

// For each selected class, its strongest spell in every line it has — plus which class holds the
// outright best of each line, so a cell can say "mine" vs "someone else's is stronger".
function matrixData(classes, level) {
  const available = SPELLS.filter((s) => classes.includes(s.class) && s.level <= level);
  const perClassLine = new Map(); // "class::line_id" -> that class's strongest spell in the line
  const lineBest = new Map(); // line_id -> strongest spell across all selected classes
  for (const s of available) {
    const lineId = s.line_id || `Other:${s.name}`;
    const key = `${s.class}::${lineId}`;
    const cur = perClassLine.get(key);
    if (!cur || spellMagnitude(s) > spellMagnitude(cur)) perClassLine.set(key, s);
    const bestSoFar = lineBest.get(lineId);
    if (!bestSoFar || spellMagnitude(s) > spellMagnitude(bestSoFar)) lineBest.set(lineId, s);
  }

  const byCategory = new Map(); // category -> class -> [{ spell, lineId, subcategory, best }]
  for (const spell of perClassLine.values()) {
    const category = spell.line_category || "Other";
    const lineId = spell.line_id || `Other:${spell.name}`;
    if (!byCategory.has(category)) byCategory.set(category, new Map());
    const perClass = byCategory.get(category);
    if (!perClass.has(spell.class)) perClass.set(spell.class, []);
    perClass.get(spell.class).push({
      spell,
      lineId,
      subcategory: spell.line_subcategory || "",
      best: lineBest.get(lineId) === spell,
      conflict: !!spell.stacking_confirmed,
    });
  }
  for (const perClass of byCategory.values()) {
    for (const cells of perClass.values()) {
      cells.sort((a, b) => a.subcategory.localeCompare(b.subcategory) || a.spell.name.localeCompare(b.spell.name));
    }
  }
  return [...byCategory.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function matrixChip(cell, className) {
  const spell = cell.spell;
  const eff = formatEffect(spell);
  const warn = cell.conflict && !cell.best ? ` <span class="mx-warn">▲</span>` : "";
  // The chip raises the spell tooltip (line, class roster with levels, full stats), so it carries
  // no `title` of its own - two tooltips describing one chip is what the browser does badly.
  // Best-in-line stays encoded where it belongs: solid vs. dimmed, explained by the legend.
  return `<span class="mx-chip ${cell.best ? "is-best" : ""}" style="--pc:${classColor(className)}"
      data-spell="${spell.spell_id}"
    >${spell.name}${eff === "—" ? "" : ` <b>${eff}</b>`}${warn}</span>`;
}

function renderMatrix(classes, level) {
  gvLast = { classes, level };
  if (classes.length === 0) {
    matrixTableEl.innerHTML = `<tbody><tr><td>${GV_EMPTY}</td></tr></tbody>`;
    matrixCountEl.innerHTML = "";
    return;
  }
  const data = matrixData(classes, level);
  const head =
    `<tr><th class="mx-corner">Category</th>` +
    classes
      .map((c) => {
        const wins = data.reduce(
          (n, [, perClass]) => n + (perClass.get(c) || []).filter((cell) => cell.best).length,
          0
        );
        return `<th class="mx-class-head" style="--pc:${classColor(c)}">${c}<span>${wins} lines best in slot</span></th>`;
      })
      .join("") +
    `</tr>`;

  const body = data
    .map(([category, perClass]) => {
      const gloss = LINE_SECTION_GLOSS[category];
      const cells = classes
        .map((c) => {
          const list = perClass.get(c) || [];
          if (list.length === 0) return `<td class="mx-cell is-empty"></td>`;
          return `<td class="mx-cell">${list.map((cell) => matrixChip(cell, c)).join("")}</td>`;
        })
        .join("");
      return `<tr><th class="mx-cat">${category}${gloss ? `<span>${gloss}</span>` : ""}</th>${cells}</tr>`;
    })
    .join("");

  matrixTableEl.innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
  const total = data.reduce(
    (n, [, perClass]) => n + [...perClass.values()].reduce((m, list) => m + list.length, 0),
    0
  );
  matrixCountEl.innerHTML = `<b>${total}</b> class·line pairs across <b>${data.length}</b> categories`;
}

// ---------------------------------------------------------------------------------------------
// C · Focus
// ---------------------------------------------------------------------------------------------

function focusCard(row) {
  const spell = row.best.spell;
  const sub = row.subcategory || "General";
  const chip = ELEMENT_COLORS[sub] ? elementChip(sub) : "";
  const pills = row.best.classLevels.map((cl) => classPill(cl.class, cl.level)).join("");
  const alts = row.runnersUp.length
    ? `<div class="fv-card-alts">${
        gvConflicted(row) ? `<em>Won't stack with:</em> ` : `Also available: `
      }${row.runnersUp
        .map((e) => `${e.classLevels.map((c) => classCode(c.class)).join("/")} ${e.spell.name}`)
        .join(", ")}</div>`
    : "";
  return `
    <article class="fv-card ${gvConflicted(row) ? "is-conflict" : ""}">
      <div class="fv-card-sub">${chip || sub}${gvConflicted(row) ? GV_WARN : ""}</div>
      <div class="fv-card-title">
        ${iconImg(spell)}
        <span class="spell-name" data-spell="${spell.spell_id}">${spell.name}</span>
      </div>
      ${formatEffect(spell) === "—" ? "" : `<div class="fv-card-eff">${formatEffect(spell)}</div>`}
      <div class="fv-card-meta">${spell.mana} mana · ${spell.duration} · ${spell.target}</div>
      <div class="fv-card-classes">${pills}</div>
      ${alts}
    </article>`;
}

function renderFocus(classes, level) {
  gvLast = { classes, level };
  if (classes.length === 0) {
    focusRailEl.innerHTML = "";
    focusDetailEl.innerHTML = GV_EMPTY;
    return;
  }
  const sections = gvSections(classes, level);
  // Keep the rail selection across class/level changes when the category still exists.
  if (!sections.some((s) => s.category === focusCategory)) focusCategory = sections[0].category;

  focusRailEl.innerHTML = sections
    .map((s) => {
      const conflicts = s.rows.filter(gvConflicted).length;
      return `<button type="button" class="${s.category === focusCategory ? "on" : ""}" data-cat="${s.category}">
          ${s.category}
          ${conflicts ? `<span class="fv-rail-warn" title="${conflicts} non-stacking buff lines">▲</span>` : ""}
          <span class="fv-rail-n">${s.rows.length}</span>
        </button>`;
    })
    .join("");

  const section = sections.find((s) => s.category === focusCategory);
  focusDetailEl.innerHTML =
    `<h4 class="fv-detail-head">${section.category}${section.gloss ? `<span>${section.gloss}</span>` : ""}</h4>` +
    `<div class="fv-cards">${section.rows.map(focusCard).join("")}</div>`;
}

// --- Controls (bound once; each re-renders only its own view) ---------------------------------

boardFilterEl.addEventListener("input", () => {
  boardFilter = boardFilterEl.value;
  renderBoard(gvLast.classes, gvLast.level);
});

boardDensityEl.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-d]");
  if (!btn) return;
  boardDensity = btn.dataset.d;
  [...boardDensityEl.querySelectorAll("button")].forEach((b) => b.classList.toggle("on", b === btn));
  renderBoard(gvLast.classes, gvLast.level);
});
[...boardDensityEl.querySelectorAll("button")].forEach((b) =>
  b.classList.toggle("on", b.dataset.d === boardDensity)
);

focusRailEl.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-cat]");
  if (!btn) return;
  focusCategory = btn.dataset.cat;
  renderFocus(gvLast.classes, gvLast.level);
});
