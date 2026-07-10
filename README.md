# EQ Legends Spell Tool

A data pipeline + static UI for figuring out what to actually memorize on an EQ Legends multiclass
character — which classes' buffs stack, and what to bring for grouping.

See [`docs/GAME_NOTES.md`](docs/GAME_NOTES.md) for what we've learned about the game itself, and
[`docs/PROJECT_GOALS.md`](docs/PROJECT_GOALS.md) for the problem this tool solves and the design
decisions behind it.

## Regenerating the data

Run in order from the repo root (each step is independently re-runnable):

```
python scrape.py          # spell tables for all 16 classes -> data/spells_raw.json
python fetch_icons.py     # spell icons -> app/icons/, data/spell_icons.json
python buff_stacking.py   # buff stacking-slot data -> data/buff_stacking.json
python parse_effects.py   # parses/classifies everything -> data/spells.json, app/data.js
```

## Using the tool

Open `app/index.html` directly in a browser (no server, no build step — it's a plain `file://` page).

- **Loadouts** — recommended Buff Loadout and role-based Grouping Loadout for your selected classes/level.
- **Category Grid** — best spell per class per category, at a glance.
- **Full Comparison** — detailed side-by-side stats for every category.

Class/level/slot-budget/role selections are saved in the URL, so you can bookmark or refresh without
losing your setup.
