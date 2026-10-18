// 실행: jsc tools/test_agent.js  (프로젝트 루트에서. macOS 기본 JavaScriptCore 사용, Node 불필요)
load("agent/agent.js");
var items = JSON.parse(readFile("data/items.json"));
var byId = {}; items.forEach(function (i) { byId[i.id] = i; });
var failures = 0;

function check(name, cond, detail) {
  print((cond ? "PASS " : "FAIL ") + name + (detail ? "  -> " + detail : ""));
  if (!cond) failures++;
}
function cats(r) { return r.picked.map(function (p) { return p.item.category; }); }
function names(r) { return r.picked.map(function (p) { return p.item.category + ":" + p.item.name; }).join(", "); }
function unique(list) { return list.filter(function (v, i) { return list.indexOf(v) === i; }); }

var minimal = Agent.diagnose([
  { styles: { "미니멀": 2, "모던": 1 }, needs: [] },
  { styles: { "미니멀": 1, "모던": 1 }, needs: [] },
  { styles: {}, needs: ["선반", "수납장", "수납 박스", "바구니", "신발 선반"], label: "물건 둘 곳이 부족해요" }
]);
var OWNED = ["책상", "의자", "스툴", "침대 프레임"];

// 1. 대표 케이스: 일반 예산(15만원)
var r1 = Agent.recommend(items, { budget: 150000, owned: OWNED, diagnosis: minimal });
check("일반 예산: 총액이 예산을 넘지 않음", r1.total <= 150000, r1.total + "원");
check("일반 예산: 추천이 1개 이상", r1.picked.length >= 1, r1.picked.length + "개");
check("일반 예산: 이미 가진 카테고리는 추천 안 함",
  r1.picked.every(function (p) { return OWNED.indexOf(p.item.category) < 0; }));
check("일반 예산: 한 카테고리에서 하나만 추천(같은 물건의 비싼/싼 버전 중복 없음)",
  unique(cats(r1)).length === cats(r1).length, cats(r1).join(","));
check("일반 예산: 원하는 수납 계열이 포함됨",
  r1.picked.some(function (p) { return ["선반", "수납장", "수납 박스", "바구니", "신발 선반"].indexOf(p.item.category) >= 0; }));
var STORAGE = ["선반", "수납장", "수납 박스", "바구니", "신발 선반"];
var storagePicked = r1.picked.filter(function (p) { return STORAGE.indexOf(p.item.category) >= 0; }).length;
check("일반 예산: 한 고민(수납)에서 최대 2개까지만 추천", storagePicked <= 2, storagePicked + "개");
check("일반 예산: 수납이 아닌 다른 카테고리도 함께 추천", r1.picked.length - storagePicked >= 2, (r1.picked.length - storagePicked) + "개");
check("일반 예산: 미룬 항목이 판단 과정에 기록됨", r1.log.join("|").indexOf("뒤로 미룬 항목") >= 0);
print("   picked: " + names(r1));

var capOk = r1.picked.every(function (p) {
  if (p.item.price <= 150000 * 0.45) return true;
  // 45%를 넘는 상품이 있다면 같은 카테고리에 45% 이하의 더 저렴한 대체가 없었어야 한다
  return !items.some(function (i) { return i.category === p.item.category && i.price < p.item.price && i.price <= 150000 * 0.45; });
});
check("일반 예산: 한 상품이 예산의 45%를 넘지 않음(더 저렴한 대체가 있는 한)", capOk);
check("일반 예산: 예산을 배분해 3개 이상 추천", r1.picked.length >= 3, r1.picked.length + "개");

// 근거 문구는 사용자가 실제로 고른 답변을 보여 주고, 말하지 않은 '필요하다'는 표현을 쓰지 않는다
var needReasons = r1.picked.map(function (p) { return p.reasons.join("|"); }).filter(function (t) { return t.indexOf("라고 답하셔서") >= 0; });
check("근거 문구: 사용자가 고른 답변 문구가 인용됨", needReasons.length > 0 && needReasons.every(function (t) { return t.indexOf("'물건 둘 곳이 부족해요'라고 답하셔서") >= 0; }), needReasons.length + "개");
check("근거 문구: '필요하다고 해서'처럼 말하지 않은 내용을 단정하지 않음", r1.picked.every(function (p) { return p.reasons.join("|").indexOf("필요하다고") < 0; }));
// 이미 있다고 체크한 수납 가구(선반, 수납장)는 고민(수납)이 있어도 추천하지 않는다
var rOwnStorage = Agent.recommend(items, { budget: 300000, owned: ["선반", "수납장"], diagnosis: minimal });
check("보유 체크: 이미 있는 수납 가구(선반, 수납장)는 추천에서 빠짐", rOwnStorage.picked.every(function (p) { return p.item.category !== "선반" && p.item.category !== "수납장"; }));

// 2. 대표 케이스: 넉넉한 예산(200만원)이면 제외 항목이 없고 카테고리를 거의 다 채움
var r2 = Agent.recommend(items, { budget: 2000000, owned: [], diagnosis: minimal });
var allCats = unique(items.map(function (i) { return i.category; }));
check("넉넉한 예산: 예산 부족으로 제외한 항목 없음", r2.skipped.length === 0);
check("넉넉한 예산: 미룬 수납 항목이 남은 예산으로 추가됨", r2.picked.some(function (p) { return p.reasons.join("|").indexOf("남은 예산으로 추가했어요") >= 0; }));
check("넉넉한 예산: 모든 카테고리에서 하나씩 추천", r2.picked.length === allCats.length, r2.picked.length + "/" + allCats.length);
check("넉넉한 예산: 총액이 예산 이내", r2.total <= 2000000, r2.total + "원");

// 3. 빠듯한 예산(6만원): 예산 초과 시 같은 카테고리의 저가 대체품으로 바꾸거나 제외하고 이유를 기록
var r3 = Agent.recommend(items, { budget: 60000, owned: OWNED, diagnosis: minimal });
check("빠듯한 예산: 총액이 예산 이내", r3.total <= 60000, r3.total + "원");
check("빠듯한 예산: 대체 또는 제외가 일어나고 이유가 기록됨", r3.log.length > 0, r3.log[0]);
check("빠듯한 예산: 대체된 상품은 원래 상품과 같은 카테고리이고 더 저렴함",
  r3.picked.every(function (p) { return !p.replacedFrom || (p.replacedFrom.category === p.item.category && p.item.price < p.replacedFrom.price); }));
print("   picked: " + names(r3));

// 4. 엣지 케이스: 예산이 너무 적음(최저가보다 낮음)
var minPrice = Math.min.apply(null, items.map(function (i) { return i.price; }));
var r4 = Agent.recommend(items, { budget: minPrice - 1, owned: [], diagnosis: minimal });
check("예산 부족: 추천 0개이고 tooLow 표시", r4.picked.length === 0 && r4.tooLow === true);
check("예산 부족: 필요한 최저 금액을 알려줌", r4.minPrice === minPrice, r4.minPrice + "원");

// 5. 엣지 케이스: 모든 카테고리를 이미 가진 경우
var r5 = Agent.recommend(items, { budget: 100000, owned: allCats, diagnosis: minimal });
check("모두 보유: 살 것이 없음으로 처리", r5.nothingToBuy === true && r5.picked.length === 0);

// 6. 취향 진단과 스타일 반영
check("진단: 점수가 가장 높은 스타일이 primary", minimal.primary === "미니멀", JSON.stringify(minimal.scores));
var warm = Agent.diagnose([{ styles: { "따뜻한": 2, "우드": 1 } }]);
var r6 = Agent.recommend(items, { budget: 2000000, owned: [], diagnosis: warm });
var warmHits = r6.picked.filter(function (p) { return p.item.styles.indexOf("따뜻한") >= 0 || p.item.styles.indexOf("우드") >= 0; }).length;
check("스타일 반영: 따뜻한·우드 취향이면 과반이 해당 스타일", warmHits * 2 > r6.picked.length, warmHits + "/" + r6.picked.length);

// 7. 원상복구: 못이 필요한 상품에는 주의 문구가 붙고, 못이 필요 없는 상품에는 안내 문구가 붙는다
var nail = r2.picked.filter(function (p) { return !p.item.noDrill; });
var noNail = r2.picked.filter(function (p) { return p.item.noDrill; });
check("원상복구: 못이 필요한 상품에 주의 문구", nail.length > 0 && nail.every(function (p) { return p.reasons.join("|").indexOf("원상복구 주의") >= 0; }), nail.length + "개");
check("원상복구: 못이 필요 없는 상품에 안내 문구", noNail.every(function (p) { return p.reasons.join("|").indexOf("못을 박지 않고") >= 0; }));

// 8. 예산과 상관없이 후보를 보여 주는 suggest (사용자가 직접 골라 예산을 맞추는 화면용)
var sg = Agent.suggest(items, { owned: OWNED, diagnosis: minimal });
var sgCats = sg.map(function (g) { return g.category; });
check("추천 목록: 보유 카테고리를 뺀 모든 카테고리가 하나씩 나옴", sg.length === allCats.filter(function (c) { return OWNED.indexOf(c) < 0; }).length && unique(sgCats).length === sg.length, sg.length + "개");
check("추천 목록: 카테고리 점수 순으로 정렬됨", sg.every(function (g, i) { return i === 0 || sg[i - 1].score >= g.score; }));
check("추천 목록: 각 카테고리 후보는 같은 카테고리 상품이고 점수 순이며 1순위가 앞에 있음",
  sg.every(function (g) { return g.options.every(function (o, i) { return o.item.category === g.category && (i === 0 || g.options[i - 1].score >= o.score); }); }));
check("추천 목록: 후보 개수가 카테고리의 전체 상품 수와 같음(예산으로 걸러내지 않음)",
  sg.every(function (g) { return g.options.length === items.filter(function (i) { return i.category === g.category; }).length; }));
var sgTiny = Agent.suggest(items, { owned: OWNED, diagnosis: minimal });
check("추천 목록: 예산과 무관함(같은 입력이면 같은 결과)", JSON.stringify(sgTiny.map(function (g) { return g.options[0].item.id; })) === JSON.stringify(sg.map(function (g) { return g.options[0].item.id; })));
check("추천 목록: 보유 체크한 카테고리는 목록에서 빠짐", Agent.suggest(items, { owned: ["선반", "수납장"], diagnosis: minimal }).every(function (g) { return g.category !== "선반" && g.category !== "수납장"; }));
var vague = ["가장 먼저 필요한 기본 아이템", "전체 구성을 채우는 데 필요해요", "필요하다고"];
check("근거 문구: 근거를 알 수 없는 모호한 문구가 없음", sg.every(function (g) { return g.options.every(function (o) {
  var t = o.reasons.join("|"); return vague.every(function (v) { return t.indexOf(v) < 0; }); }); }));
var sgWarm = Agent.suggest(items, { owned: [], diagnosis: warm });
var sgMin = Agent.suggest(items, { owned: [], diagnosis: minimal });
var diffTop = sgWarm.filter(function (g) { var m = sgMin.filter(function (x) { return x.category === g.category; })[0]; return m && m.options[0].item.id !== g.options[0].item.id; }).length;
check("추천 목록: 취향이 다르면 1순위 상품이 달라짐", diffTop >= 3, diffTop + "개 카테고리");

// 9. 데이터 규모
check("데이터: 150개 안팎의 상품과 20개 이상의 카테고리", items.length >= 150 && allCats.length >= 20, items.length + "개 / " + allCats.length + "개");

print(failures ? "\n" + failures + " FAILED" : "\nALL PASSED");
if (failures) quit(1);
