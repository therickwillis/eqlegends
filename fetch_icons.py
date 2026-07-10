"""Fetch spell icons for every scraped spell from eqlwiki.com.

Each spell has its own wiki page using {{Spellpage|spellicon=<code>|...}},
which renders [[File:spellicon_<code>.png]]. Several hundred spells share
a handful of icon codes (generic gem/glyph art), so we:

  1. Look up each distinct spell name's page to find its spellicon code.
  2. Resolve each distinct icon code to an actual image URL via the
     MediaWiki imageinfo API.
  3. Download each distinct icon once into app/icons/.

Writes data/spell_icons.json: {spell_name: "icons/spellicon_<code>.png"},
which parse_effects.py attaches to each spell record as `icon`.
"""
import json
import re
import time
import urllib.request
import urllib.parse
from pathlib import Path

API_URL = "https://eqlwiki.com/api.php"
USER_AGENT = "eqlegends-spell-tool/0.1 (personal research script)"
BATCH_SIZE = 50

DATA_DIR = Path(__file__).parent / "data"
ICONS_DIR = Path(__file__).parent / "app" / "icons"

SPELLICON_RE = re.compile(r"spellicon\s*=\s*([^\s|\n}]+)")


def api_get(params: dict) -> dict:
    url = f"{API_URL}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def chunked(items, size):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def fetch_icon_codes(names: list) -> dict:
    """Returns {spell_name: icon_code} for every name whose page has a spellicon."""
    name_to_code = {}
    for batch in chunked(names, BATCH_SIZE):
        data = api_get({
            "action": "query",
            "prop": "revisions",
            "rvslots": "main",
            "rvprop": "content",
            "format": "json",
            "titles": "|".join(batch),
        })
        pages = data.get("query", {}).get("pages", {})
        for page in pages.values():
            if "missing" in page or "revisions" not in page:
                continue
            title = page["title"]
            content = page["revisions"][0]["slots"]["main"]["*"]
            m = SPELLICON_RE.search(content)
            if m:
                name_to_code[title] = m.group(1)
        print(f"  resolved {len(name_to_code)} icon codes so far...")
        time.sleep(0.3)
    return name_to_code


def fetch_icon_urls(codes: list) -> dict:
    """Returns {icon_code: image_url} via the imageinfo API."""
    code_to_url = {}
    titles_by_code = {f"File:spellicon_{code}.png": code for code in codes}
    for batch in chunked(list(titles_by_code.keys()), BATCH_SIZE):
        data = api_get({
            "action": "query",
            "titles": "|".join(batch),
            "prop": "imageinfo",
            "iiprop": "url",
            "format": "json",
        })
        pages = data.get("query", {}).get("pages", {})
        for page in pages.values():
            if "missing" in page or "imageinfo" not in page:
                continue
            url = page["imageinfo"][0]["url"]
            # Recover the code from the original (un-normalized) title batch
            normalized = {n["to"]: n["from"] for n in data.get("query", {}).get("normalized", [])}
            original_title = normalized.get(page["title"], page["title"])
            code = titles_by_code.get(original_title)
            if code:
                code_to_url[code] = url
        time.sleep(0.3)
    return code_to_url


def download_icons(code_to_url: dict):
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    for code, url in code_to_url.items():
        dest = ICONS_DIR / f"spellicon_{code}.png"
        if dest.exists():
            continue
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=30) as resp:
            dest.write_bytes(resp.read())
        time.sleep(0.15)


def main():
    raw = json.loads((DATA_DIR / "spells_raw.json").read_text(encoding="utf-8"))
    names = sorted(set(s["name"] for s in raw))
    print(f"Looking up icon codes for {len(names)} distinct spell names...")
    name_to_code = fetch_icon_codes(names)
    print(f"Found icon codes for {len(name_to_code)}/{len(names)} spells")

    distinct_codes = sorted(set(name_to_code.values()))
    print(f"Resolving {len(distinct_codes)} distinct icon files...")
    code_to_url = fetch_icon_urls(distinct_codes)
    print(f"Resolved {len(code_to_url)}/{len(distinct_codes)} icon URLs")

    print("Downloading icons...")
    download_icons(code_to_url)

    name_to_path = {
        name: f"icons/spellicon_{code}.png"
        for name, code in name_to_code.items()
        if code in code_to_url
    }
    (DATA_DIR / "spell_icons.json").write_text(json.dumps(name_to_path, indent=2), encoding="utf-8")
    print(f"Wrote {len(name_to_path)} spell->icon mappings to data/spell_icons.json")
    print(f"Downloaded {len(list(ICONS_DIR.glob('*.png')))} icon files to app/icons/")


if __name__ == "__main__":
    main()
