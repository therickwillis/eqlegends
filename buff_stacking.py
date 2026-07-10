"""Build a spell -> buff-stacking-group mapping from eqlwiki.com's Buff Lines page.

That page hand-curates buffs by the underlying game "slot" they occupy (e.g.
"AC (Slot 1)" lists Cleric's Courage and Druid's Skin Like Wood together,
meaning they don't stack - only the stronger one takes effect). A spell can
appear under more than one heading (a combo buff like Courage grants both an
AC bonus and an HP bonus, so it occupies two separate slots), so each spell
maps to a *list* of groups, not a single one.

Writes data/buff_stacking.json: {spell_name_lowercase: [{"group_id", "label"}, ...]}
"""
import json
import re
import urllib.request
import urllib.parse
from pathlib import Path

from scrape import CLASSES, API_URL, USER_AGENT

DATA_DIR = Path(__file__).parent / "data"
PAGE_TITLE = "Buff Lines"

HEADING_RE = re.compile(r"^(={2,6})\s*(.+?)\s*=+\s*$", re.MULTILINE)
TD_RE = re.compile(r"<td[^>]*>(.*?)</td>", re.DOTALL | re.IGNORECASE)
LINK_WITH_TRAILER_RE = re.compile(r"\[\[([^\]|#]+?)(?:\|[^\]]*?)?\]\]((?:\s*\([^)]*\))+)")
CLASS_ALTERNATION = "|".join(re.escape(c) for c in CLASSES)
CLASS_IN_TRAILER_RE = re.compile(rf"\[\[({CLASS_ALTERNATION})\]\]")


def fetch_wikitext(title: str) -> str:
    params = urllib.parse.urlencode({
        "action": "query", "prop": "revisions", "rvslots": "main",
        "rvprop": "content", "format": "json", "titles": title,
    })
    req = urllib.request.Request(f"{API_URL}?{params}", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.load(resp)
    page = next(iter(data["query"]["pages"].values()))
    return page["revisions"][0]["slots"]["main"]["*"]


def slugify(text: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", text.lower())).strip("-")


def heading_sections(wikitext: str):
    """Yields (heading_path, direct_content) for every heading, where
    direct_content is everything up to the next heading of any level."""
    matches = list(HEADING_RE.finditer(wikitext))
    stack = []
    for i, m in enumerate(matches):
        level = len(m.group(1))
        title = m.group(2).strip()
        stack = stack[: level - 2] + [title]
        path = " > ".join(stack)
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(wikitext)
        yield path, title, wikitext[start:end]


def extract_groups_from_text(text: str):
    """Returns the set of spell names (as-linked) mentioned alongside a
    recognized class name in this chunk of wikitext."""
    names = set()
    for m in LINK_WITH_TRAILER_RE.finditer(text):
        name, trailer = m.group(1).strip(), m.group(2)
        if CLASS_IN_TRAILER_RE.search(trailer):
            names.add(name)
    return names


def build_stacking_map(wikitext: str) -> dict:
    spell_groups = {}  # lowercase name -> list of {"group_id", "label"}

    def add(name: str, group_id: str, label: str):
        key = name.lower()
        entry = {"group_id": group_id, "label": label}
        existing = spell_groups.setdefault(key, [])
        if not any(e["group_id"] == group_id for e in existing):
            existing.append(entry)

    for path, title, content in heading_sections(wikitext):
        cells = TD_RE.findall(content)
        if cells:
            for i, cell_text in enumerate(cells):
                names = extract_groups_from_text(cell_text)
                if not names:
                    continue
                group_id = f"{slugify(path)}--cell{i}"
                label = title if len(cells) == 1 else f"{title} (variant {i + 1})"
                for name in names:
                    add(name, group_id, label)
        else:
            names = extract_groups_from_text(content)
            if not names:
                continue
            group_id = slugify(path)
            for name in names:
                add(name, group_id, title)

    return spell_groups


def main():
    print(f"Fetching '{PAGE_TITLE}' from eqlwiki.com...")
    wikitext = fetch_wikitext(PAGE_TITLE)
    stacking_map = build_stacking_map(wikitext)

    out_path = DATA_DIR / "buff_stacking.json"
    out_path.write_text(json.dumps(stacking_map, indent=2), encoding="utf-8")
    print(f"Wrote {len(stacking_map)} spell -> stacking-group mappings to {out_path}")


if __name__ == "__main__":
    main()
