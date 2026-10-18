"""ABO 메타데이터에서 자취방에 맞는 가구 후보를 걸러 썸네일을 받는다. 실행: python3 tools/abo_candidates.py
입력: data/raw/abo/listings_*.json.gz, images.csv.gz (git 제외 폴더)   출력: data/raw/abo/candidates.json, thumbs/"""
import csv, glob, gzip, json, random, re, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from PIL import Image

RAW = Path("data/raw/abo"); THUMBS = RAW / "thumbs"; THUMBS.mkdir(exist_ok=True)
BASE = "https://amazon-berkeley-objects.s3.amazonaws.com/images/small/"
PER_CATEGORY = 8

# 상품 유형 -> (우리 카테고리, 허용 최대 치수 w,d,h cm). None이면 해당 치수는 제한하지 않는다
TYPE_MAP = {
    "CHAIR": ("의자", (80, 85, 120)), "SOFA": ("소파", (200, 100, 100)),
    "STOOL_SEATING": ("스툴", (60, 60, 80)), "OTTOMAN": ("스툴", (80, 80, 60)),
    "BEAN_BAG_CHAIR": ("빈백", (130, 130, 110)), "BENCH": ("벤치", (130, 50, 60)),
    "TABLE": ("테이블", (120, 80, 80)), "DESK": ("책상", (140, 70, 80)),
    "RUG": ("러그", (200, 150, 3)), "WALL_ART": ("벽장식", (120, 10, 120)),
    "CLOCK": ("시계", (50, 15, 50)), "HOME_MIRROR": ("거울", (80, 12, 180)),
    "LAMP": ("조명", (60, 60, 200)), "PILLOW": ("쿠션", (60, 25, 60)),
    "PLANTER": ("화분", (50, 50, 100)), "VASE": ("꽃병", (30, 30, 60)),
    "SHELF": ("선반", (100, 40, 200)), "CABINET": ("수납장", (100, 50, 120)),
    "STORAGE_BOX": ("수납 박스", (60, 50, 50)), "CLOTHES_RACK": ("옷걸이 행거", (120, 60, 180)),
    "BASKET": ("바구니", (60, 50, 50)), "BED_FRAME": ("침대 프레임", (150, 220, 120)),
    "CURTAIN": ("커튼", (200, 5, 260)),
}
# 납작한 상품은 ABO의 치수 축이 뒤섞여 있어서(두께가 가로나 높이 칸에 들어감) 정렬한 치수(두께<=짧은 변<=긴 변)로 판단한다
FLAT = {"러그": (3, 150, 200), "벽장식": (8, 120, 150), "거울": (12, 90, 180),
        "시계": (15, 50, 50), "커튼": (8, 200, 260), "쿠션": (30, 60, 60)}
BEDDING = re.compile(r"\b(comforter|duvet|bedding set|quilt|sheet set|blanket|throw)\b", re.I)
BAD = re.compile(r"\b(cover|slipcover|replacement|cushion pad|for kids|toy|doll)\b", re.I)

def en_name(r):
    for n in r.get("item_name", []):
        if n.get("language_tag", "").startswith("en"): return n["value"]

def dims_cm(r):
    d = r.get("item_dimensions") or {}
    out = []
    for k in ("width", "length", "height"):
        v = (d.get(k) or {}).get("normalized_value")
        if not v: return None
        out.append(round(v["value"] * 2.54, 1))
    return out  # [가로, 깊이, 높이]

def white_bg(path):
    im = Image.open(path).convert("RGB"); w, h = im.size
    pts = [(1,1),(w-2,1),(1,h-2),(w-2,h-2),(w//2,1),(w//2,h-2),(1,h//2),(w-2,h//2)]
    return all(min(im.getpixel(p)) >= 245 for p in pts)

def main():
    images = {r["image_id"]: r["path"] for r in csv.DictReader(gzip.open(RAW / "images.csv.gz", "rt", encoding="utf-8"))}
    pool = {}
    for f in sorted(glob.glob(str(RAW / "listings_*.json.gz"))):
        for line in gzip.open(f, "rt", encoding="utf-8"):
            r = json.loads(line); t = (r.get("product_type") or [{}])[0].get("value")
            name = en_name(r); iid = r.get("main_image_id"); dm = dims_cm(r)
            if not (name and iid in images and dm) or BAD.search(name): continue
            cat = None
            if t in TYPE_MAP:
                cat, (mw, md, mh) = TYPE_MAP[t]
                if min(dm) <= 0: continue
                if cat in FLAT:
                    a, b, c = sorted(dm); lim = FLAT[cat]
                    if a > lim[0] or b > lim[1] or c > lim[2]: continue
                else:
                    w, d, h = dm
                    if w > mw or d > md or h > mh: continue
            elif t == "HOME_BED_AND_BATH" and BEDDING.search(name) and max(dm) <= 260:
                cat = "침구"
            if cat:
                pool.setdefault(cat, []).append({"item_id": r["item_id"], "type": t, "category": cat, "name_en": name,
                    "w_cm": dm[0], "d_cm": dm[1], "h_cm": dm[2], "image": images[iid]})
    random.seed(7)
    result = {}

    def fetch(it):
        dest = THUMBS / (it["item_id"] + ".jpg")
        if not dest.exists():
            try: urllib.request.urlretrieve(BASE + it["image"], dest)
            except Exception: return None
        return it if white_bg(dest) else (dest.unlink() or None)

    for cat, items in sorted(pool.items()):
        random.shuffle(items)
        with ThreadPoolExecutor(8) as ex:
            ok = [x for x in ex.map(fetch, items[:250]) if x]
        kept = ok[:PER_CATEGORY]
        for it in kept:
            if cat in FLAT:  # 사진의 긴 쪽에 긴 변을 맞춘다
                a, b, c = sorted((it["w_cm"], it["d_cm"], it["h_cm"]))
                iw, ih = Image.open(THUMBS / (it["item_id"] + ".jpg")).size
                long_side, short_side = (c, b)
                it["w_cm"], it["d_cm"], it["h_cm"] = (long_side, short_side, a) if iw >= ih else (short_side, long_side, a)
        result[cat] = kept
        print(f"{cat:8s} 후보 풀 {len(items):4d} -> 흰 배경 통과 {len(ok):3d} -> 채택 {len(kept)}", flush=True)
    json.dump(result, open(RAW / "candidates.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)

main()
