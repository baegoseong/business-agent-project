"""Validate data/items.json against docs/data-schema.md. Run: python3 tools/validate_data.py"""
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STYLES = {"미니멀", "모던", "우드", "따뜻한"}
VIEWS = {"front", "top"}
REQUIRED = ["id", "name", "category", "price", "priceBasis", "size", "view", "aspect", "styles", "noDrill", "priority", "image", "source"]

def main():
    items = json.loads((ROOT / "data/items.json").read_text(encoding="utf-8"))
    errors = []
    ids = [i.get("id") for i in items]
    if len(ids) != len(set(ids)):
        errors.append("duplicate ids")
    by_id = {i.get("id"): i for i in items}
    try:
        from PIL import Image
    except ImportError:
        Image = None
        print("note: Pillow not installed, skipping image aspect check")

    for it in items:
        tag = it.get("id", "?")
        missing = [f for f in REQUIRED if f not in it]
        if missing:
            errors.append(f"{tag}: missing fields {missing}")
            continue
        if not (isinstance(it["price"], int) and it["price"] > 0):
            errors.append(f"{tag}: price must be a positive integer")
        if it["priceBasis"] != "estimate":
            errors.append(f"{tag}: priceBasis must be 'estimate' (prices are not real shop prices)")
        if not it["styles"] or not set(it["styles"]) <= STYLES:
            errors.append(f"{tag}: invalid styles {it['styles']}")
        if it["view"] not in VIEWS:
            errors.append(f"{tag}: invalid view")
        if it["priority"] not in (1, 2, 3):
            errors.append(f"{tag}: priority must be 1-3")
        if not isinstance(it["noDrill"], bool):
            errors.append(f"{tag}: noDrill must be boolean")
        if not all(isinstance(it["size"].get(k), (int, float)) and it["size"][k] > 0 for k in "wdh"):
            errors.append(f"{tag}: size w/d/h must be positive numbers")
        if not (isinstance(it["aspect"], (int, float)) and 0.1 <= it["aspect"] <= 10):
            errors.append(f"{tag}: aspect out of range")
        if it["source"].get("license") != "CC BY 4.0":
            errors.append(f"{tag}: source license must be 'CC BY 4.0'")
        alt = it.get("alternativeTo")
        if alt:
            if alt not in by_id:
                errors.append(f"{tag}: alternativeTo '{alt}' not found")
            elif by_id[alt]["price"] <= it["price"]:
                errors.append(f"{tag}: alternative must be cheaper than '{alt}'")
            elif by_id[alt]["category"] != it["category"]:
                errors.append(f"{tag}: alternative must be in the same category")
        img = ROOT / it["image"]
        if not img.exists():
            errors.append(f"{tag}: image file missing ({it['image']})")
        elif Image:
            w, h = Image.open(img).size
            if abs(h / w - it["aspect"]) > 0.01:
                errors.append(f"{tag}: aspect {it['aspect']} != image {h / w:.3f}")

    covered = {s for it in items for s in it.get("styles", [])}
    if covered != STYLES:
        errors.append(f"styles without any item: {STYLES - covered}")

    cats = sorted({i["category"] for i in items if "category" in i})
    print(f"{len(items)} items, {len(cats)} categories")
    if errors:
        print("FAILED"); [print(" -", e) for e in errors]; sys.exit(1)
    print("OK: all checks passed")

if __name__ == "__main__":
    main()
