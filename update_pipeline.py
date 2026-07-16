"""Runs the full spell-data pipeline in order. This is the one command to run after an EQ
Legends client update (new spells, rebalanced numbers, etc.) - by default it re-derives
everything from the local game install (F:\\EverquestLegends) without touching the network.

Pipeline:
  1. extract_client_spells.py  - game client spells_us.txt -> data/spells_client_raw.json
  2. scrape.py                 - eqlwiki.com spell index    -> data/spells_wiki_index.json  [--refresh-index]
  3. build_spells_raw.py       - client + wiki index        -> data/spells_raw.json
  4. fetch_icons.py            - eqlwiki.com icons          -> data/spell_icons.json         [--refresh-icons]
  5. build_buff_stacking.py    - client effect-slot data    -> data/buff_stacking.json
  6. parse_effects.py          - final merge                -> data/spells.json, app/data.js
  7. classify_roles.py         - role-affinity analysis     -> data/class_roles.json

Steps 2/4 hit eqlwiki.com and are skipped by default (their existing data/*.json output is
reused) since a client update doesn't necessarily mean the wiki's spell list or icons changed.
The wiki index (step 2) also only needs a refresh when EQ Legends adds/removes spells, not when
existing spell numbers get rebalanced - the client always wins for numbers regardless. Step 5
used to scrape eqlwiki.com's Buff Lines page too (buff_stacking.py, still here but unused by
this script) - it's now computed straight from client effect-slot data instead, which is both
more complete and doesn't need a network refresh flag.

Usage:
  python update_pipeline.py                 # client-only refresh (the common case)
  python update_pipeline.py --full           # also refresh wiki index/icons/stacking
  python update_pipeline.py --refresh-index  # just the wiki spell index
"""
import argparse
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent


def run(script: str, label: str):
    print(f"\n=== {label} ({script}) ===", flush=True)
    result = subprocess.run([sys.executable, str(ROOT / script)], cwd=ROOT)
    if result.returncode != 0:
        print(f"\n'{script}' failed (exit {result.returncode}) - stopping.")
        sys.exit(result.returncode)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--full", action="store_true",
                         help="also refresh the wiki index, icons, and buff-stacking data")
    parser.add_argument("--refresh-index", action="store_true", help="refresh the wiki spell index")
    parser.add_argument("--refresh-icons", action="store_true", help="refresh spell icons")
    args = parser.parse_args()

    refresh_index = args.full or args.refresh_index
    refresh_icons = args.full or args.refresh_icons

    missing = [f for f in ("data/spells_wiki_index.json", "data/spell_icons.json")
               if not (ROOT / f).exists()]
    if missing and not (refresh_index and refresh_icons):
        print("First run detected - missing:", ", ".join(missing))
        print("Forcing --full for this run so every wiki-sourced file gets created.\n")
        refresh_index = refresh_icons = True

    run("extract_client_spells.py", "1/7 Extracting spell data from the game client")

    if refresh_index:
        run("scrape.py", "2/7 Refreshing wiki spell index (network)")
    else:
        print("\n=== 2/7 Wiki spell index: skipped (pass --refresh-index or --full to update) ===")

    run("build_spells_raw.py", "3/7 Building spells_raw.json from client + wiki index")

    if refresh_icons:
        run("fetch_icons.py", "4/7 Refreshing spell icons (network)")
    else:
        print("\n=== 4/7 Spell icons: skipped (pass --refresh-icons or --full to update) ===")

    run("build_buff_stacking.py", "5/7 Computing buff-stacking data from client effect slots")

    run("parse_effects.py", "6/7 Building final data/spells.json + app/data.js")
    run("classify_roles.py", "7/7 Computing class role-affinity analysis")

    print("\nDone. data/spells.json and app/data.js are up to date.")


if __name__ == "__main__":
    main()
