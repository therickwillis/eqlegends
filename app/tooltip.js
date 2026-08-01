// In-game-style spell tooltip. A single floating panel, shared across the whole UI, shown when
// hovering anything tagged with `data-spell="<spell_id>"` (spell icons and names, via app.js).
//
// The same spell_id is shared by multiple classes (a spell one class gets at Lv 12 and another at
// Lv 22 is one spell), so we aggregate a class→level roster per id and show it in the footer, the
// way the game's own spell description does. Everything else on the tooltip is intrinsic to the
// spell: mana, cast/recast, duration, target, resist, and the per-slot effect lines.

// spell_id -> { spell, classLevels: [{ class, level }] }. Built once from SPELLS (data.js). The
// representative `spell` is the lowest-level instance, but every field we show is class-agnostic.
const SPELL_INDEX = (() => {
  const index = new Map();
  for (const s of SPELLS) {
    let entry = index.get(s.spell_id);
    if (!entry) {
      entry = { spell: s, classLevels: [] };
      index.set(s.spell_id, entry);
    }
    entry.classLevels.push({ class: s.class, level: s.level });
    if (s.level < entry.spell.level) entry.spell = s;
  }
  for (const entry of index.values()) {
    entry.classLevels.sort((a, b) => a.level - b.level || a.class.localeCompare(b.class));
  }
  return index;
})();

// The game client stores the line separator as a byte that shows up as a replacement char (�);
// render it as the "›" it's meant to be. Also used to prettify the header subtitle.
function cleanLine(text) {
  return (text || "").replace(/�/g, "›").replace(/\s*›\s*/g, " › ");
}

function fmtSeconds(sec) {
  if (sec == null) return null;
  if (sec === 0) return "Instant";
  return Number.isInteger(sec) ? `${sec}s` : `${sec.toFixed(1)}s`;
}

// A labeled stat cell, only when the value is worth showing. Kept null-safe so the grid stays tidy
// (e.g. a beneficial buff with no resist and no recast just omits those cells).
function statCell(label, value) {
  if (value == null || value === "") return "";
  return `<div class="tt-stat"><span class="tt-stat-label">${label}</span><span class="tt-stat-val">${value}</span></div>`;
}

// The description is already "Increase AC by 5<br>Increase STR by 5"; split it into the numbered
// effect slots the in-game spell window shows. A lone non-effecty line (e.g. "Summon Pet") still
// reads fine as "Slot 1".
function effectLines(spell) {
  const parts = (spell.description || "")
    .split(/<br\s*\/?>/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return "";
  return parts
    .map((p, i) => `<div class="tt-effect"><span class="tt-slot">Slot ${i + 1}</span>${p}</div>`)
    .join("");
}

function tooltipHTML(entry) {
  const spell = entry.spell;
  const kind = spell.beneficial ? "Beneficial" : "Detrimental";
  const subtitle = cleanLine(spell.line) || spell.category || "";

  const stats = [
    statCell("Mana", spell.mana),
    statCell("Cast", fmtSeconds(spell.cast_time_s)),
    statCell("Recast", spell.recast_time_s ? fmtSeconds(spell.recast_time_s) : null),
    statCell("Duration", spell.duration),
    statCell("Target", spell.target),
    statCell("Range", spell.range),
    statCell("Resist", spell.resist_type),
  ].join("");

  // Reuse app.js's per-class pills so the roster reads with the same colors as the rest of the UI.
  const roster = entry.classLevels
    .map((cl) => classPill(cl.class, cl.level))
    .join("");

  // The game's own prose description (dbstr type 6, resolved in the data pipeline) - the flavor +
  // effect summary the in-game spell window shows. Every spell has one.
  const prose = spell.description_text
    ? `<div class="tt-desc">${spell.description_text}</div>`
    : "";

  return `
    <div class="tt-head tt-${spell.beneficial ? "ben" : "det"}">
      ${iconImg(spell)}
      <div class="tt-titles">
        <div class="tt-name">${spell.name}</div>
        <div class="tt-sub">${kind}${subtitle ? " · " + subtitle : ""}</div>
      </div>
    </div>
    ${prose}
    <div class="tt-stats">${stats}</div>
    <div class="tt-effects">${effectLines(spell)}</div>
    <div class="tt-roster">${roster}</div>`;
}

const tooltipEl = document.createElement("div");
tooltipEl.className = "spell-tooltip";
tooltipEl.setAttribute("role", "tooltip");
document.body.appendChild(tooltipEl);

let currentId = null;

function positionTooltip(x, y) {
  const pad = 14;
  const rect = tooltipEl.getBoundingClientRect();
  let left = x + 18;
  let top = y + 18;
  if (left + rect.width + pad > window.innerWidth) left = x - rect.width - 18;
  if (left < pad) left = pad;
  if (top + rect.height + pad > window.innerHeight) top = y - rect.height - 18;
  if (top < pad) top = pad;
  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.top = `${top}px`;
}

function hideTooltip() {
  currentId = null;
  tooltipEl.classList.remove("visible");
}

document.addEventListener("mouseover", (e) => {
  const target = e.target.closest("[data-spell]");
  if (!target) return;
  const id = target.dataset.spell;
  const entry = SPELL_INDEX.get(Number(id)) || SPELL_INDEX.get(id);
  if (!entry) return;
  if (id !== currentId) {
    currentId = id;
    tooltipEl.innerHTML = tooltipHTML(entry);
  }
  tooltipEl.classList.add("visible");
  positionTooltip(e.clientX, e.clientY);
});

document.addEventListener("mousemove", (e) => {
  if (!currentId) return;
  // Left the trigger without a mouseover landing elsewhere (e.g. moved onto empty space).
  if (!e.target.closest("[data-spell]")) {
    hideTooltip();
    return;
  }
  positionTooltip(e.clientX, e.clientY);
});

// Scrolling (e.g. the sticky rank table) can slide the trigger out from under a static tooltip.
document.addEventListener("scroll", hideTooltip, true);
