"""Validate data/items.json against docs/data-schema.md. Run: python3 tools/validate_data.py"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STYLES = {"미니멀", "모던", "우드", "따뜻한"}
VIEWS = {"front", "top"}
REQUIRED = ["id", "name", "category", "price", "size", "view", "styles", "noDrill", "priority", "image"]


def main():
    items = json.loads((ROOT / "data/items.json").read_text(encoding="utf-8"))
    errors = []
    ids = [i.get("id") for i in items]
    if len(ids) != len(set(ids)):
        errors.append("duplicate ids")
    by_id = {i.get("id"): i for i in items}

    for it in items:
        tag = it.get("id", "?")
        for f in REQUIRED:
            if f not in it:
                errors.append(f"{tag}: missing field '{f}'")
        if errors and any(e.startswith(f"{tag}: missing") for e in errors):
            continue
        if not (isinstance(it["price"], int) and it["price"] > 0):
            errors.append(f"{tag}: price must be a positive integer")
        if not set(it["styles"]) <= STYLES or not it["styles"]:
            errors.append(f"{tag}: invalid styles {it['styles']}")
        if it["view"] not in VIEWS:
            errors.append(f"{tag}: invalid view")
        if it["priority"] not in (1, 2, 3):
            errors.append(f"{tag}: priority must be 1-3")
        if not all(isinstance(it["size"].get(k), (int, float)) and it["size"][k] > 0 for k in "wdh"):
            errors.append(f"{tag}: size w/d/h must be positive numbers")
            continue
        alt = it.get("alternativeTo")
        if alt:
            if alt not in by_id:
                errors.append(f"{tag}: alternativeTo '{alt}' not found")
            elif by_id[alt]["price"] <= it["price"]:
                errors.append(f"{tag}: alternative must be cheaper than '{alt}'")
        svg = ROOT / it["image"]
        if not svg.exists():
            errors.append(f"{tag}: image file missing ({it['image']})")
            continue
        m = re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', svg.read_text(encoding="utf-8"))
        if not m:
            errors.append(f"{tag}: svg has no viewBox")
            continue
        sw, sh = float(m[1]), float(m[2])
        ew, eh = it["size"]["w"], (it["size"]["d"] if it["view"] == "top" else it["size"]["h"])
        if abs(sw / sh - ew / eh) > 0.02 * (ew / eh) + 0.05 and abs(sw - ew) + abs(sh - eh) > 1:
            errors.append(f"{tag}: svg {sw}x{sh} does not match size {ew}x{eh}")

    covered = {s for it in items for s in it.get("styles", [])}
    if covered != STYLES:
        errors.append(f"styles without any item: {STYLES - covered}")

    print(f"{len(items)} items, categories: {sorted({i['category'] for i in items})}")
    if errors:
        print("FAILED"); [print(" -", e) for e in errors]; sys.exit(1)
    print("OK: all checks passed")


if __name__ == "__main__":
    main()
