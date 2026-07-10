"""Scrape spell tables for every EQ Legends class from eqlwiki.com (MediaWiki).

Pulls raw wikitext for each class page via the MediaWiki API, extracts the
per-level {{RadSpellRow2 ...}} template blocks, and writes one normalized
record per spell to data/spells_raw.json.
"""
import json
import re
import time
import urllib.request
import urllib.parse
from pathlib import Path

API_URL = "https://eqlwiki.com/api.php"
USER_AGENT = "eqlegends-spell-tool/0.1 (personal research script)"

CLASSES = [
    "Bard", "Beastlord", "Berserker", "Cleric", "Druid", "Enchanter",
    "Magician", "Monk", "Necromancer", "Paladin", "Ranger", "Rogue",
    "Shadow Knight", "Shaman", "Warrior", "Wizard",
]

LEVEL_HEADING_RE = re.compile(r"==\s*Level\s+(\d+)\s*==")
TEMPLATE_START_RE = re.compile(r"\{\{RadSpellRow2")
TEMPLATE_WRAPPER_RE = re.compile(r"\{\{([^{}|]+)\}\}")


def fetch_wikitext(title: str) -> str:
    params = urllib.parse.urlencode({
        "action": "query",
        "prop": "revisions",
        "rvslots": "main",
        "rvprop": "content",
        "format": "json",
        "titles": title,
    })
    req = urllib.request.Request(f"{API_URL}?{params}", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.load(resp)
    pages = data["query"]["pages"]
    page = next(iter(pages.values()))
    return page["revisions"][0]["slots"]["main"]["*"]


def extract_level_sections(wikitext: str):
    """Split wikitext into (level, section_text) chunks based on ==Level N== headings."""
    matches = list(LEVEL_HEADING_RE.finditer(wikitext))
    sections = []
    for i, m in enumerate(matches):
        level = int(m.group(1))
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(wikitext)
        sections.append((level, wikitext[start:end]))
    return sections


def extract_templates(section_text: str):
    """Find each {{RadSpellRow2 ...}} block, respecting nested {{...}} templates inside fields."""
    blocks = []
    for start_match in TEMPLATE_START_RE.finditer(section_text):
        pos = start_match.end()
        depth = 1  # matched one "{{" already
        i = pos
        while i < len(section_text) and depth > 0:
            if section_text.startswith("{{", i):
                depth += 1
                i += 2
            elif section_text.startswith("}}", i):
                depth -= 1
                i += 2
            else:
                i += 1
        blocks.append(section_text[pos:i - 2])
    return blocks


def clean_value(value: str) -> str:
    value = value.strip()
    # Unwrap simple {{Template Name}} wrapper values (e.g. era={{Classic Short}})
    m = TEMPLATE_WRAPPER_RE.fullmatch(value)
    if m:
        value = m.group(1).strip()
    return value


def parse_template_fields(block: str) -> dict:
    fields = {}
    # Split on lines starting with '|', but keep multi-line values (e.g. max=...<br>...) joined
    parts = re.split(r"\n\|", block)
    for part in parts:
        part = part.strip()
        if not part or "=" not in part:
            continue
        key, _, value = part.partition("=")
        fields[key.strip().lstrip("|")] = clean_value(value)
    return fields


def scrape_class(class_name: str) -> list:
    wikitext = fetch_wikitext(class_name)
    records = []
    for level, section_text in extract_level_sections(wikitext):
        for block in extract_templates(section_text):
            fields = parse_template_fields(block)
            if "name" not in fields:
                continue
            records.append({
                "class": class_name,
                "level": level,
                "name": fields.get("name", ""),
                "kind": fields.get("kind", ""),
                "target": fields.get("targ", ""),
                "mana": fields.get("mana", ""),
                "duration": fields.get("duration", ""),
                "max_raw": fields.get("max", ""),
                "description": fields.get("description", ""),
                "school": fields.get("school", ""),
                "location": fields.get("location", ""),
                "era": fields.get("era", ""),
            })
    return records


def main():
    out_dir = Path(__file__).parent / "data"
    out_dir.mkdir(exist_ok=True)

    all_records = []
    for class_name in CLASSES:
        print(f"Scraping {class_name}...")
        records = scrape_class(class_name)
        print(f"  {len(records)} spells found")
        all_records.extend(records)
        time.sleep(0.5)  # be polite to the wiki

    out_path = out_dir / "spells_raw.json"
    out_path.write_text(json.dumps(all_records, indent=2), encoding="utf-8")
    print(f"\nWrote {len(all_records)} spell records to {out_path}")


if __name__ == "__main__":
    main()
