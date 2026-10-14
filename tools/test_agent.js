// 실행: jsc tools/test_agent.js  (프로젝트 루트에서. macOS 기본 JavaScriptCore 사용, Node 불필요)
load("agent/agent.js");
var items = JSON.parse(readFile("data/items.json"));
var failures = 0;

function check(name, cond, detail) {
  print((cond ? "PASS " : "FAIL ") + name + (detail ? "  -> " + detail : ""));
  if (!cond) failures++;
}
function names(r) { return r.picked.map(function (p) { return p.item.id; }).join(", "); }

var minimal = Agent.diagnose([
  { styles: { "미니멀": 2, "모던": 1 }, needs: [] },
  { styles: { "미니멀": 1, "모던": 1 }, needs: [] },
  { styles: {}, needs: ["수납"] }
]);

// 1. 대표 케이스: 일반 예산(15만원)
var r1 = Agent.recommend(items, { budget: 150000, owned: ["책상", "의자"], diagnosis: minimal });
check("일반 예산: 총액이 예산을 넘지 않음", r1.total <= 150000, r1.total + "원");
check("일반 예산: 이미 가진 카테고리(책상/의자)는 추천 안 함",
  r1.picked.every(function (p) { return p.item.category !== "책상" && p.item.category !== "의자"; }));
check("일반 예산: '수납'을 원했으므로 수납이 포함됨",
  r1.picked.some(function (p) { return p.item.category === "수납"; }));
check("일반 예산: 같은 계열(선반 비싼/싼 버전) 중복 없음",
  r1.picked.filter(function (p) { return ["shelf-wood", "shelf-slim", "drawer-cart", "storage-box"].indexOf(p.item.id) >= 0; }).length === 1);
print("   picked: " + names(r1));

// 2. 대표 케이스: 넉넉한 예산(60만원)이면 제외 항목이 없음
var r2 = Agent.recommend(items, { budget: 600000, owned: [], diagnosis: minimal });
check("넉넉한 예산: 제외 항목 없음", r2.skipped.length === 0 && r2.log.length === 0);
check("넉넉한 예산: 총액이 예산 이내", r2.total <= 600000, r2.total + "원");

// 3. 예산이 빠듯하면 대체품으로 교체
var r3 = Agent.recommend(items, { budget: 80000, owned: ["책상", "의자"], diagnosis: minimal });
check("빠듯한 예산: 총액이 예산 이내", r3.total <= 80000, r3.total + "원");
check("빠듯한 예산: 대체 또는 제외가 일어나고 이유가 기록됨", r3.log.length > 0, r3.log.join(" | "));
print("   picked: " + names(r3));

// 4. 엣지 케이스: 예산이 너무 적음(5천원 < 최저가 1만원)
var r4 = Agent.recommend(items, { budget: 5000, owned: [], diagnosis: minimal });
check("예산 부족: 추천 0개이고 tooLow 표시", r4.picked.length === 0 && r4.tooLow === true);
check("예산 부족: 필요한 최저 금액을 알려줌", r4.minPrice === 10000, r4.minPrice + "원");

// 5. 엣지 케이스: 모든 카테고리를 이미 가진 경우
var all = items.map(function (i) { return i.category; });
var r5 = Agent.recommend(items, { budget: 100000, owned: all, diagnosis: minimal });
check("모두 보유: 살 것이 없음으로 처리", r5.nothingToBuy === true && r5.picked.length === 0);

// 6. 취향 진단
check("진단: 점수가 가장 높은 스타일이 primary", minimal.primary === "미니멀", JSON.stringify(minimal.scores));
check("진단: 선택하지 않은 보강 항목(needs) 반영", minimal.needs.indexOf("수납") >= 0);
var warm = Agent.diagnose([{ styles: { "따뜻한": 2, "우드": 1 } }]);
r6 = Agent.recommend(items, { budget: 200000, owned: [], diagnosis: warm });
var styleHits = r6.picked.filter(function (p) { return p.item.styles.indexOf("따뜻한") >= 0; }).length;
check("스타일 반영: 따뜻한 취향이면 과반이 따뜻한 스타일", styleHits * 2 > r6.picked.length, styleHits + "/" + r6.picked.length);

print(failures ? "\n" + failures + " FAILED" : "\nALL PASSED");
if (failures) quit(1);
