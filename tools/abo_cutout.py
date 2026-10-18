"""원본 상품 사진의 흰 배경을 지워 투명 WebP로 만들고, 실패한 것을 자동 표시한다. 실행: python3 tools/abo_cutout.py
입력: data/raw/abo/original/*.jpg   출력: data/raw/abo/cutout/*.webp, cutout_report.json, sheets/*.png (모두 git 제외 폴더)"""
import collections, json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

RAW = Path("data/raw/abo"); OUT = RAW / "cutout"; SHEETS = RAW / "sheets"
OUT.mkdir(exist_ok=True); SHEETS.mkdir(exist_ok=True)
WORK = 600      # 배경 제거는 이 크기에서
FINAL = 520     # 저장 크기(긴 변)
TOL = 18        # 배경색과의 허용 차이
HOLE_WHITE = 252  # 갇힌 영역으로 볼 순백의 기준 (R,G,B 모두 이 값 이상)
HOLE_MIN = 60     # 이 픽셀 수 이상 이어진 순백 영역만 지움

def cutout(path):
    im = Image.open(path).convert("RGB"); im.thumbnail((WORK, WORK), Image.LANCZOS)
    w, h = im.size; px = im.load()
    bg = px[1, 1]
    close = lambda c: all(abs(c[i] - bg[i]) <= TOL for i in range(3))
    seen = bytearray(w * h); dq = collections.deque()
    def push(x, y):
        if not seen[y*w+x] and close(px[x, y]): seen[y*w+x] = 1; dq.append((x, y))
    for x in range(w): push(x, 0); push(x, h-1)
    for y in range(h): push(0, y); push(w-1, y)
    while dq:
        x, y = dq.popleft()
        if x+1 < w: push(x+1, y)
        if x > 0: push(x-1, y)
        if y+1 < h: push(x, y+1)
        if y > 0: push(x, y-1)
    # 가구 안쪽에 갇힌 배경(책장 칸, 의자 다리 사이): 아주 순수한 흰색이 일정 크기 이상 이어진 영역만 지운다
    visited = bytearray(w * h)
    for y in range(h):
        for x in range(w):
            i0 = y * w + x
            if seen[i0] or visited[i0] or min(px[x, y]) < HOLE_WHITE: continue
            comp = [i0]; visited[i0] = 1; stack = [(x, y)]
            while stack:
                cx, cy = stack.pop()
                for nx, ny in ((cx+1, cy), (cx-1, cy), (cx, cy+1), (cx, cy-1)):
                    if 0 <= nx < w and 0 <= ny < h:
                        j = ny * w + nx
                        if not seen[j] and not visited[j] and min(px[nx, ny]) >= HOLE_WHITE:
                            visited[j] = 1; comp.append(j); stack.append((nx, ny))
            if len(comp) >= HOLE_MIN:
                for j in comp: seen[j] = 1
    mask = Image.frombytes("L", (w, h), bytes(0 if s else 255 for s in seen))
    mask = mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))  # 흰 테두리 줄이고 가장자리 부드럽게
    out = im.convert("RGBA"); out.putalpha(mask)
    bbox = out.getbbox()
    opaque = sum(1 for v in mask.getdata() if v > 128) / (w * h)
    edge_bg = sum(seen[x] + seen[(h-1)*w+x] for x in range(w)) / (2 * w)   # 윗·아랫변 중 배경으로 지워진 비율
    return out, bbox, bg, opaque, edge_bg

def judge(bg, opaque, edge_bg, bbox, size):
    why = []
    if min(bg) < 235: why.append(f"배경이 흰색이 아님{bg}")
    if opaque < 0.06: why.append(f"남은 면적 너무 작음({opaque:.0%})")
    if opaque > 0.90: why.append(f"배경이 거의 안 지워짐({opaque:.0%})")
    if edge_bg < 0.5: why.append("가장자리 대부분이 배경 아님(연출 컷 가능성)")
    return why

items = json.load(open(RAW / "candidates_ko.json", encoding="utf-8"))
report = []
for it in items:
    src = RAW / "original" / (it["item_id"] + ".jpg")
    out, bbox, bg, opaque, edge_bg = cutout(src)
    why = judge(bg, opaque, edge_bg, bbox, out.size)
    img = out.crop(bbox); img.thumbnail((FINAL, FINAL), Image.LANCZOS)
    dest = OUT / (it["item_id"] + ".webp"); img.save(dest, "WEBP", quality=85, method=6)
    report.append({"no": it["no"], "item_id": it["item_id"], "category": it["category"], "bg": bg, "opaque": round(opaque, 2),
                   "size": list(img.size), "kb": round(dest.stat().st_size / 1024), "flags": why})
    print(f'{it["no"]:3d} {it["category"]:6s} {"FLAG " + "; ".join(why) if why else "ok"}', flush=True)
json.dump(report, open(RAW / "cutout_report.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)

# 확인용 컨택트 시트 (번호, 빨간 글씨 = 자동 표시)
CELL = 200; COLS = 6; PER = 36
for s in range(0, len(report), PER):
    chunk = report[s:s+PER]; rows = (len(chunk) + COLS - 1) // COLS
    sheet = Image.new("RGB", (COLS*CELL, rows*(CELL+18)), (226, 219, 204)); d = ImageDraw.Draw(sheet)
    for k, r in enumerate(chunk):
        im = Image.open(OUT / (r["item_id"] + ".webp")).convert("RGBA"); im.thumbnail((CELL-10, CELL-10))
        x, y = (k % COLS)*CELL, (k // COLS)*(CELL+18)
        sheet.paste(im, (x+5+(CELL-10-im.width)//2, y+18+(CELL-10-im.height)//2), im)
        d.text((x+4, y+3), f'{r["no"]} {r["category"]}', fill=(200, 0, 0) if r["flags"] else (30, 30, 30))
    sheet.save(SHEETS / f"sheet_{s//PER+1}.png")
print("flagged:", sum(1 for r in report if r["flags"]), "/", len(report), "| total KB:", sum(r["kb"] for r in report))
