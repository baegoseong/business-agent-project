"""후보(candidates_ko.json)와 배경 제거 결과로 새 가구 데이터를 만든다. 실행: python3 tools/abo_build_items.py
출력: data/items.json, assets/products/*.webp
가격은 ABO에 없으므로 카테고리별 기준가와 크기·키워드로 '추정'한 참고 가격이다."""
import json, math, re, shutil
from mount_rules import mount_of
from pathlib import Path
from PIL import Image

RAW = Path("data/raw/abo"); OUT_IMG = Path("assets/products"); OUT_IMG.mkdir(parents=True, exist_ok=True)
EXCLUDE = {23, 65, 81, 106, 113, 114, 163, 73, 108, 166, 170, 6, 7}   # 배경 제거 실패 또는 안내 문구 사진
BRANDS = ["스톤앤빔", "아마존베이직", "라베나홈", "라이벳", "솔리모", "모비안", "알코브", "로시니", "핀존", "드림폼", "UMI", "ABC홈", "어반리빙", "스트랫우드", "아이리스"]

# 카테고리: (기준가 원, 기준 크기 cm (w,d,h), 크기 보정 방식, 필요도 1~3, 못 없이 설치 가능)
# 크기 보정: cube=부피의 세제곱근, area=가로x높이(또는 러그는 가로x깊이), none=보정 없음
CAT = {
 "침구": (50000, None, "none", 1, True), "선반": (70000, (60, 35, 150), "cube", 1, True), "수납장": (90000, (55, 40, 60), "cube", 1, True),
 "조명": (45000, (30, 30, 100), "cube", 2, True), "의자": (60000, (60, 60, 85), "cube", 2, True), "책상": (90000, (100, 55, 75), "cube", 2, True),
 "테이블": (55000, (50, 50, 50), "cube", 2, True), "침대 프레임": (130000, (140, 190, 35), "cube", 2, True), "거울": (40000, (60, 90), "area", 2, False),
 "바구니": (18000, (35, 35, 30), "cube", 2, True), "수납 박스": (15000, (30, 30, 30), "cube", 2, True), "신발 선반": (30000, (70, 25, 80), "cube", 2, True),
 "러그": (90000, (120, 180), "area", 3, True), "쿠션": (15000, None, "none", 3, True), "시계": (18000, None, "none", 3, False),
 "벽장식": (35000, (60, 60), "area", 3, False), "꽃병": (22000, (15, 15, 25), "cube", 3, True), "화분": (28000, (22, 22, 25), "cube", 3, True),
 "소품": (15000, None, "none", 3, True), "벤치": (90000, (100, 40, 48), "cube", 3, True), "스툴": (45000, (50, 50, 60), "cube", 3, True),
 "소파": (250000, (170, 90, 85), "cube", 3, True),
}
KW_PRICE = [(r"가죽|leather", 1.4), (r"벨벳|velvet", 1.15), (r"원목|우드|월넛|wood", 1.15), (r"메탈|metal|steel", 1.05)]
STYLE_KW = {
 "우드": r"wood|원목|우드|월넛|walnut|espresso|에스프레소|oak|오크|seagrass|시그래스|farmhouse|팜하우스|ash|애시",
 "모던": r"modern|모던|contemporary|컨템포러리|leather|가죽|metal|메탈|chrome|크롬|glass|유리|marble|mid-century|미드센추리|industrial|인더스트리얼|office|사무",
 "미니멀": r"white|화이트|gr[ae]y|그레이|scandinavian|스칸디나비아|simple|minimal|silver|실버|black|블랙|basics|아마존베이직",
 "따뜻한": r"velvet|벨벳|linen|린넨|beige|베이지|cream|크림|tan|탠|sand|샌드|boho|rustic|러스틱|vintage|빈티지|brown|브라운|ivory|아이보리|gold|골드|brass|브라스|taupe|토프",
}

FLAT_CATS = {"러그", "벽장식", "거울", "시계", "쿠션"}

def fix_size(cat, it, aspect):
    """ABO 치수 축이 뒤섞이거나 포장 상자 치수인 경우를 사진 비율로 보정한다. (w, d, h) cm 반환"""
    w, d, h = it["w_cm"], it["d_cm"], it["h_cm"]
    if cat in FLAT_CATS:
        t, a, b = sorted([w, d, h])      # 두께 <= 짧은 변 <= 긴 변. 잘라낸 사진이 세로로 길면 짧은 변이 가로
        if cat == "러그": return (a, b, t) if aspect >= 1 else (b, a, t)   # (가로, 사진 세로 방향 길이, 두께)
        return (a, t, b) if aspect >= 1 else (b, t, a)                       # (가로, 두께, 높이)
    dims = sorted([w, d, h])
    if dims[0] < 8 and cat in {"선반", "신발 선반", "침구"}:   # 포장 상자 치수로 보이는 경우: 가장 긴 변을 가로로 보고 높이는 사진 비율로
        W = dims[1] if cat == "침구" else dims[2]
        return round(W, 1), round(dims[1] if cat != "침구" else dims[2], 1), round(W * aspect, 1)
    best = None                          # 사진의 세로/가로 비율과 가장 잘 맞는 (가로, 높이) 조합을 고른다
    for i in range(3):
        for j in range(3):
            if i == j: continue
            err = abs(math.log((dims_all := [w, d, h])[j] / dims_all[i] / aspect))
            if best is None or err < best[0] - 1e-9: best = (err, i, j)
    _, i, j = best; k = 3 - i - j; v = [w, d, h]
    return v[i], v[k], v[j]

def jitter(item_id):
    """가격 편차: 같은 카테고리 상품이 모두 같은 가격이 되지 않도록 id로 정한 ±12% 변동(제품 사양 차이를 단순화한 추정)"""
    return 0.88 + (sum(ord(c) for c in item_id) % 25) / 100

def price(cat, it):
    base, ref, mode, *_ = CAT[cat]
    w, d, h = it["w_cm"], it["d_cm"], it["h_cm"]
    if mode == "cube": s = (max(w*d*h, 1) ** (1/3) / (ref[0]*ref[1]*ref[2]) ** (1/3)) ** 1.2
    elif mode == "area": s = (math.sqrt(max(w*d, 1) / (ref[0]*ref[1]))) ** 1.2
    else: s = 1.0
    p = base * min(max(s, 0.5), 2.5) * jitter(it["item_id"])
    for pat, m in KW_PRICE:
        if re.search(pat, it["name_ko"] + " " + it["name_en"], re.I): p *= m
    m = re.search(r"(\d+)개 세트", it["name_ko"])
    if m: p *= min(4.0, 1 + 0.7 * (int(m.group(1)) - 1))
    unit = 500 if p < 20000 else 1000 if p < 100000 else 5000
    return int(round(p / unit) * unit)

def styles(it):
    text = it["name_ko"] + " " + it["name_en"]
    found = [s for s, pat in STYLE_KW.items() if re.search(pat, text, re.I)]
    return found[:3] or ["미니멀"]

def short_name(full):
    brand = next((b for b in BRANDS if full.startswith(b)), "")
    s = re.sub(r"\s*\(.*?\)", "", full).strip()
    if brand: s = s[len(brand):].strip()
    return brand, (s or full)

cands = json.load(open(RAW / "candidates_ko.json", encoding="utf-8"))
items = []
for it in cands:
    if it["no"] in EXCLUDE: continue
    cat = it["category"]; cfg = CAT[cat]
    src = RAW / "cutout" / (it["item_id"] + ".webp"); dst = OUT_IMG / (it["item_id"] + ".webp"); shutil.copyfile(src, dst)
    iw, ih = Image.open(dst).size; brand, short = short_name(it["name_ko"])
    aspect = ih / iw; fw, fd, fh = fix_size(cat, it, aspect)
    items.append({"id": it["item_id"], "name": short, "brand": brand, "fullName": it["name_ko"], "category": cat,
        "price": price(cat, it), "priceBasis": "estimate",
        "size": {"w": fw, "d": fd, "h": fh}, "view": "top" if cat == "러그" else "front",
        "aspect": round(aspect, 3), "styles": styles(it), "noDrill": mount_of(cat, it["name_ko"]) != "wall", "mount": mount_of(cat, it["name_ko"]), "priority": cfg[3],
        "image": f"assets/products/{it['item_id']}.webp",
        "source": {"name": "Amazon Berkeley Objects", "license": "CC BY 4.0", "itemId": it["item_id"]}})

# 같은 카테고리 안에서 가격 순으로 저가 대체 관계를 잇는다 (싼 쪽이 바로 위 가격대를 가리킴)
by_cat = {}
for i in items: by_cat.setdefault(i["category"], []).append(i)
for cat, lst in by_cat.items():
    lst.sort(key=lambda x: (-x["price"], x["id"]))
    for k in range(1, len(lst)):
        if lst[k]["price"] >= lst[k-1]["price"]: lst[k]["price"] = lst[k-1]["price"] - 500
        lst[k]["alternativeTo"] = lst[k-1]["id"]
items.sort(key=lambda x: (list(CAT).index(x["category"]), -x["price"]))
json.dump(items, open("data/items.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
json.dump(sorted(EXCLUDE), open(RAW / "excluded.json", "w"))
print(len(items), "items,", len(by_cat), "categories")
for cat, lst in by_cat.items():
    ps = [x["price"] for x in lst]
    print(f"{cat:6s} {len(lst):2d}개  가격 {min(ps):>7,} ~ {max(ps):>7,}원")
