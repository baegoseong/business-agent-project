"""candidates_ko.json의 상품 원본 이미지를 개별로 받는다. 실행: python3 tools/abo_images.py
저장: data/raw/abo/original/<item_id>.jpg (git 제외 폴더)"""
import json, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

RAW = Path("data/raw/abo"); OUT = RAW / "original"; OUT.mkdir(exist_ok=True)
BASE = "https://amazon-berkeley-objects.s3.amazonaws.com/images/original/"

def get(it):
    dest = OUT / (it["item_id"] + ".jpg")
    if dest.exists() and dest.stat().st_size > 0: return it["item_id"], dest.stat().st_size, "cached"
    try:
        urllib.request.urlretrieve(BASE + it["image"], dest)
        return it["item_id"], dest.stat().st_size, "ok"
    except Exception as e:
        if dest.exists(): dest.unlink()
        return it["item_id"], 0, f"FAILED {e}"

items = json.load(open(RAW / "candidates_ko.json", encoding="utf-8"))
total = fail = 0
with ThreadPoolExecutor(6) as ex:
    for i, (iid, size, status) in enumerate(ex.map(get, items), 1):
        total += size
        if status.startswith("FAILED"): fail += 1; print(iid, status, flush=True)
        if i % 20 == 0 or i == len(items): print(f"{i}/{len(items)} 완료, 누적 {total/1048576:.1f} MB, 실패 {fail}", flush=True)
