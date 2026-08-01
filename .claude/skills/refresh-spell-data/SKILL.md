---
name: refresh-spell-data
description: Re-mine spell data from the local EQ Legends client and publish the updated site to GitHub Pages. Use after a game patch, when spell numbers look stale or wrong, when the wiki adds/removes spells, or when asked to "update the spell data", "re-run the pipeline", "regenerate data.js", or "publish the site".
---

# Refresh spell data from the client and publish

Two phases: **mine** (re-derive every JSON from the local game install) and **publish**
(commit + push to `master`, which auto-deploys to Pages). Do not publish without running the
verification in between — a client format change can silently empty the dataset.

## 1. Preflight

The client is the source of truth and it is **not** in the repo. Confirm it is present:

```powershell
Get-ChildItem "F:\EverquestLegends\spells_us.txt", "F:\EverquestLegends\dbstr_us.txt" |
  Select-Object Name, Length, LastWriteTime
```

If either file is missing, stop and tell the user — the path is hardcoded as `GAME_DIR` in
`extract_client_spells.py:20`. If the game was installed somewhere else, that constant is the
only place to change.

Record the current baseline so you can diff against it afterward:

```powershell
python -c "import json;d=json.load(open('data/spells.json'));print(len(d),'spells')"
git status --short
```

Start from a clean tree. If there are unrelated edits in progress, say so and let the user decide
whether to proceed — the pipeline rewrites tracked files wholesale.

## 2. Mine

```powershell
python update_pipeline.py
```

That is the client-only refresh and the right default: a game patch changes numbers, and the
client always wins for numbers. The two network steps (wiki spell index, icons) are skipped and
their existing JSON is reused.

Use `--full` only when the set of spells itself changed — EQ Legends added or removed spells, or
changed which class/level can cast one. That curation is server-side policy and exists nowhere in
the client, so it can only come from eqlwiki.com. Narrower flags: `--refresh-index` (spell list
only), `--refresh-icons` (icons only).

The run is 7 steps and prints a header per step. **Read the output rather than just checking the
exit code** — several steps report data-quality numbers that are not failures but are signals:

- Step 1 prints `N spells carry a spell line` and `N spells carry description text`. A collapse
  here means the `dbstr_us.txt` type-5/type-6 tables or the field offsets moved.
- Step 3 prints `Matched X/Y wiki-indexed spells` plus every unmatched entry by name. A handful of
  unmatched entries is normal drift; dozens means the wiki index is stale (re-run with
  `--refresh-index`) or client spell names changed.
- Step 6 prints the final enriched spell count and category list.

## 3. Verify before publishing

This is the step that matters. The pipeline exits 0 on a structurally-valid but empty or gutted
dataset, and `app/data.js` feeds a live public site.

```powershell
python -c "import json;d=json.load(open('data/spells.json'));print(len(d),'spells');import collections;print(collections.Counter(s['category'] for s in d).most_common())"
git diff --stat
```

Judge it against the baseline from step 1:

- **Spell count** should move by a small delta, or not at all. A large drop is a parse failure, not
  a patch. Investigate before committing.
- **Category breakdown** should stay broadly proportional. A category emptying out points at the
  SPA classification in `parse_effects.py`.
- **An empty `git diff` is a normal, expected result.** The pipeline is deterministic: if the
  client has not been patched since the last run, every output is byte-identical and there is
  simply nothing to publish. Do not go hunting for a failure, and do not force an empty commit —
  report "no client changes" and stop. Distinguish this from a real failure by the step output:
  if step 6 printed its enriched-spell count, it ran.
- Spot-check one known spell end to end. `Superior Healing` (id 9) is the reference used to
  validate the parser: 185 mana, 3.5s cast, Cleric level 30.

```powershell
python -c "import json;d=json.load(open('data/spells.json'));print([s for s in d if s['name']=='Superior Healing'][:1])"
```

If the client's `spells_us.txt` field layout changed in a patch, the failure mode is wrong values
rather than a crash — fields are read positionally. `extract_client_spells.py` documents the
expected 173-field layout and which offsets are load-bearing (86/87 spell line, 165 SpellGroup,
85 description index, 36–51 per-class levels). Cross-reference
https://github.com/rumstil/eqspellparser if offsets need re-deriving.

## 4. Publish

Only after verification passes. Commit the regenerated data — note `data/spells_client_raw.json`
is gitignored (~70MB) and should never appear in the diff:

```powershell
git add app/data.js data/
git commit -m "Refresh spell data from client build <version-or-date>"
git push origin master
```

The push triggers `.github/workflows/pages.yml`, which uploads `app/` and deploys. Watch it:

```powershell
gh run watch $(gh run list --limit 1 --json databaseId --jq '.[0].databaseId') --exit-status --interval 10
```

Then confirm the site actually serves the new data, rather than trusting a green check:

```powershell
$r = Invoke-WebRequest "https://therickwillis.github.io/eqlegends/data.js" -UseBasicParsing
"$($r.StatusCode) $([math]::Round($r.RawContentLength/1KB,1))KB"
```

Report the deployed URL and the spell-count delta.

## Notes

- The repo is **public**, and `app/data.js` plus `app/icons/` are extracted client assets. Every
  publish re-exposes them. The user has accepted this, but do not expand what gets published
  (e.g. do not start committing `data/spells_client_raw.json`) without asking.
- `buff_stacking.py` still exists but is unused — buff lines now come from the client's own
  Category/Subcategory taxonomy via `build_buff_stacking.py`. Don't wire the old scraper back in.
- The pipeline is ordered and fails fast; a mid-pipeline failure leaves earlier outputs already
  rewritten on disk. `git checkout -- data/ app/data.js` restores the last published state.
- `app/data.js` is emitted alongside `data/spells.json` specifically so the UI works from
  `file://` with no server. Keep both.
