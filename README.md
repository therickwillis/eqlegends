# EQ Legends Spell Tool

A data pipeline + static UI for figuring out what to actually memorize on an EQ Legends multiclass
character — which classes' buffs stack, and what to bring for grouping.

See [`docs/GAME_NOTES.md`](docs/GAME_NOTES.md) for what we've learned about the game itself, and
[`docs/PROJECT_GOALS.md`](docs/PROJECT_GOALS.md) for the problem this tool solves and the design
decisions behind it.

## Regenerating the data

One command re-derives everything from the local game client (no network by default):

```
python update_pipeline.py          # client-only refresh (the common case)
python update_pipeline.py --full   # also refresh the wiki spell index + icons
```

It runs, in order: `extract_client_spells.py` (parse the client's `spells_us.txt` +
`dbstr_us.txt`, including each spell's line/Category), `build_spells_raw.py` (match the wiki
spell index to client records, compute effects), `build_buff_stacking.py` (buff-stacking lines
from the client's own spell-line taxonomy), `parse_effects.py` (final merge → `data/spells.json`,
`app/data.js`), and `classify_roles.py`. The wiki steps (`scrape.py`, `fetch_icons.py`) are
skipped unless `--full`/`--refresh-*` is passed. Each script is also independently re-runnable.

## Using the tool

Open `app/index.html` directly in a browser (no server, no build step — it's a plain `file://` page).

- **Loadouts** — recommended Buff Loadout for your selected classes/level, against your slot budget.
- **Buff Template** — a Quick Buff set scored by who you actually cast on.
- **Category Grid** — best spell per spell line, organized by the client's own taxonomy.
- **A · Board / B · Matrix / C · Focus** — three viewport-fit takes on that same board: newspaper
  columns, a category × class matrix, and a category rail with detail cards. None of them scroll the page.
- **Full Comparison** — detailed side-by-side stats for every category.
- **Rank Lab** — experimental weighted multi-stat scoring with live sliders.

Class 1/2/3 are color-coded (blue / amber / rose) everywhere a spell shows who gets it, so the color
always points back to a specific dropdown. Class/level/slot-budget selections are saved in the URL, so
you can bookmark or refresh without losing your setup.
