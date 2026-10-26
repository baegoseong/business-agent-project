"""상품의 설치 방식(mount)을 정하는 규칙. 실행하면 data/items.json에 mount를 넣고 noDrill을 mount에서 다시 계산한다.
  wall  = 벽에 걸거나 붙이는 제품. 못·타공이 필요할 수 있다 (원상복구 주의)
  hang  = 옷장 봉 등에 걸어서 쓰는 제품. 벽에 못이 필요 없다
  place = 바닥이나 탁자 위에 그냥 놓는 제품
실행: python3 tools/mount_rules.py"""
import json
import re
from pathlib import Path

WALL_CATEGORIES = {"거울", "시계", "벽장식"}
WALL_NAME = re.compile(r"벽걸이|벽부착|벽 거울|벽시계|벽 장식")
HANG_NAME = re.compile(r"걸이형")


def mount_of(category, name):
    if category in WALL_CATEGORIES or WALL_NAME.search(name):
        return "wall"
    if category == "선반" and HANG_NAME.search(name):
        return "hang"
    return "place"


def main():
    path = Path("data/items.json")
    items = json.loads(path.read_text(encoding="utf-8"))
    for it in items:
        it["mount"] = mount_of(it["category"], it["fullName"])
        it["noDrill"] = it["mount"] != "wall"
    # 필드 순서를 읽기 좋게 유지: noDrill 바로 뒤에 mount
    out = []
    for it in items:
        o = {}
        for k, v in it.items():
            if k == "mount":
                continue
            o[k] = v
            if k == "noDrill":
                o["mount"] = it["mount"]
        out.append(o)
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    counts = {}
    for it in out:
        counts[it["mount"]] = counts.get(it["mount"], 0) + 1
    print(counts)


if __name__ == "__main__":
    main()
