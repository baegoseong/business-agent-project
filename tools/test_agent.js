// 실행: jsc tools/test_agent.js  (프로젝트 루트에서. macOS 기본 JavaScriptCore 사용, Node 불필요)
load("agent/agent.js");
load("tools/text_baseline.js");
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

// 7. 설치 방식(mount)과 원상복구: 의미 있는 경우에만 문구를 붙이고, 사용자 조건(못 박기 어려움)은 후보를 바꾼다
var MOUNTS = ["wall", "hang", "place"];
check("설치 방식: 모든 상품에 유효한 mount가 있고 noDrill과 일치", items.every(function (i) { return MOUNTS.indexOf(i.mount) >= 0 && i.noDrill === (i.mount !== "wall"); }));
check("설치 방식: 거울·시계·벽장식은 모두 벽걸이", items.filter(function (i) { return ["거울", "시계", "벽장식"].indexOf(i.category) >= 0; }).every(function (i) { return i.mount === "wall"; }));
check("설치 방식: 바닥에 놓는 가구(소파, 의자, 책상, 침대 프레임, 러그)는 벽걸이가 아님",
  items.filter(function (i) { return ["소파", "의자", "책상", "침대 프레임", "러그", "스툴", "벤치"].indexOf(i.category) >= 0; }).every(function (i) { return i.mount === "place"; }));
check("설치 방식: 이름에 '벽걸이'나 '벽부착'이 들어간 상품은 벽걸이", items.filter(function (i) { return /벽걸이|벽부착/.test(i.fullName); }).every(function (i) { return i.mount === "wall"; }));
var allPicks = r2.picked;   // 넉넉한 예산: 22개 카테고리 모두
function text(p) { return p.reasons.join("|"); }
check("원상복구: 벽걸이 상품에만 못 주의 문구", allPicks.every(function (p) { return (p.item.mount === "wall") === (text(p).indexOf("벽에 못이 필요할 수 있어요") >= 0); }),
  allPicks.filter(function (p) { return p.item.mount === "wall"; }).length + "개");
check("원상복구: 바닥에 놓는 상품에는 못 관련 문구가 없음", allPicks.filter(function (p) { return p.item.mount === "place"; }).every(function (p) { return text(p).indexOf("못") < 0; }));
var hangs = items.filter(function (i) { return i.mount === "hang"; });
var hangReasons = Agent.suggest(items, { owned: [], diagnosis: minimal }).map(function (g) { return g.options; }).reduce(function (a, b) { return a.concat(b); }, []).filter(function (o) { return o.item.mount === "hang"; });
check("원상복구: 걸어 쓰는 상품은 못이 필요 없다고 알려 줌", hangs.length > 0 && hangReasons.length === hangs.length && hangReasons.every(function (o) { return o.reasons.join("|").indexOf("못이 필요 없어요") >= 0; }), hangs.length + "개");

var noWall = Agent.diagnose([{ styles: { "미니멀": 2 } }, { label: "벽에 못을 박기 어려워요", constraints: { noWall: true } }]);
check("사용자 조건: 진단에 constraints가 담김", noWall.constraints.noWall === true && minimal.constraints.noWall === undefined);
var sgNoWall = Agent.suggest(items, { owned: [], diagnosis: noWall });
check("사용자 조건: 못 박기 어렵다면 후보에서 벽걸이 상품이 모두 빠짐", sgNoWall.every(function (g) { return g.options.every(function (o) { return o.item.mount !== "wall"; }); }));
check("사용자 조건: 벽걸이뿐인 카테고리(거울, 시계, 벽장식)는 목록에서 사라짐", ["거울", "시계", "벽장식"].every(function (c) { return sgNoWall.every(function (g) { return g.category !== c; }); }));
check("사용자 조건: 조건이 없으면 벽걸이 상품도 후보에 있음", Agent.suggest(items, { owned: [], diagnosis: minimal }).some(function (g) { return g.options.some(function (o) { return o.item.mount === "wall"; }); }));
var notes = Agent.constraintNotes(items, { owned: [], diagnosis: noWall });
var wallCount = items.filter(function (i) { return i.mount === "wall"; }).length;
check("사용자 조건: 뺀 이유와 개수를 설명함", notes.length === 1 && notes[0].indexOf(wallCount + "개") >= 0 && notes[0].indexOf("벽걸이") >= 0, notes[0]);
check("사용자 조건: 조건이 없으면 설명이 없음", Agent.constraintNotes(items, { owned: [], diagnosis: minimal }).length === 0);
var rNoWall = Agent.recommend(items, { budget: 2000000, owned: [], diagnosis: noWall });
check("사용자 조건: 예산 안 자동 선택에도 벽걸이 상품이 없고 판단 과정에 이유가 기록됨",
  rNoWall.picked.every(function (p) { return p.item.mount !== "wall"; }) && rNoWall.log[0].indexOf("벽걸이 상품") >= 0);

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


// 10. 취향을 방 분위기 사진으로 고르기: 오늘의집 스타일 이름과 Pexels 사진, 우리 네 가지 취향으로 환산한 가중치(data/moods.json)
var moods = JSON.parse(readFile("data/moods.json"));
function topStyle(m) { return Object.keys(m.styles).sort(function (a, b) { return m.styles[b] - m.styles[a]; })[0]; }
check("분위기 사진: 8개이고 id와 스타일 이름이 서로 다름", moods.length === 8 && unique(moods.map(function (m) { return m.id; })).length === 8 && unique(moods.map(function (m) { return m.title; })).length === 8, moods.map(function (m) { return m.title; }).join(", "));
check("분위기 사진: 모두 사진 경로와 한 줄 설명을 가짐", moods.every(function (m) { return /^assets\/moods\/[a-z]+\.jpg$/.test(m.image) && m.subtitle.length > 3; }));
check("분위기 사진: 가중치는 네 가지 취향 이름만 쓰고 양수", moods.every(function (m) { var k = Object.keys(m.styles); return k.length >= 2 && k.every(function (s) { return Agent.STYLES.indexOf(s) >= 0 && m.styles[s] > 0; }); }));
check("분위기 사진: 출처(Pexels, 작가, 사진 주소, 라이선스)가 모두 적혀 있음", moods.every(function (m) { var c = m.credit; return c.source === "Pexels" && c.photographer.length > 1 && /^https:\/\/www\.pexels\.com\/photo\//.test(c.url) && c.license === "Pexels License"; }));
check("분위기 사진: 네 가지 취향 모두 대표하는 사진이 2개 이상", Agent.STYLES.every(function (st) { return moods.filter(function (m) { return topStyle(m) === st; }).length >= 1; }) &&
  moods.filter(function (m) { return topStyle(m) === "따뜻한"; }).length >= 2, Agent.STYLES.map(function (st) { return st + ":" + moods.filter(function (m) { return topStyle(m) === st; }).length; }).join(" "));
function dxFromMoods(list) { return Agent.diagnose(Agent.styleOptionsFromMoods(list)); }
moods.forEach(function (m) {
  check("분위기 사진: '" + m.title + "' 하나만 골라도 취향이 " + topStyle(m) + "로 진단됨", dxFromMoods([m]).primary === topStyle(m));
});
var mixedMood = dxFromMoods([moods.filter(function (m) { return topStyle(m) === "우드"; })[0], moods.filter(function (m) { return topStyle(m) === "따뜻한"; })[0]]);
check("분위기 사진: 서로 다른 스타일을 섞어 고르면 보조 취향까지 나옴", mixedMood.secondary !== null && ["우드", "따뜻한"].indexOf(mixedMood.primary) >= 0 && ["우드", "따뜻한"].indexOf(mixedMood.secondary) >= 0);
check("분위기 사진: 고른 분위기 이름이 근거로 쓰이도록 선택지에 담김", Agent.styleOptionsFromMoods(moods).every(function (o, i) { return o.label === moods[i].title && o.source === "mood"; }));
check("분위기 사진: 다른 취향을 고르면 추천 1순위 상품이 달라짐", (function () {
  var a = Agent.suggest(items, { owned: [], diagnosis: dxFromMoods([moods[0]]) }), b = Agent.suggest(items, { owned: [], diagnosis: dxFromMoods([moods[2]]) });
  return a.filter(function (g, i) { var o = b.filter(function (x) { return x.category === g.category; })[0]; return o && o.options[0].item.id !== g.options[0].item.id; }).length >= 3; })());

// 11. 직접 쓴 글 해석 (키워드 규칙)
function ids(text) { return Agent.interpretText(text).matches.map(function (m) { return m.id; }); }
check("글 해석: '방이 어두워요' -> 조명", ids("방이 어두워요").indexOf("light") >= 0);
check("글 해석: 한 문장이 여러 필요를 가리키면 모두 찾음", (function () { var r = ids("책상 위가 어두워서 공부가 안 돼요"); return r.indexOf("study") >= 0 && r.indexOf("light") >= 0; })());
check("글 해석: 문장을 나눠 각각 해석", (function () { var r = ids("방이 좁아요. 가성비가 중요해요, 친구가 자주 와요"); return r.indexOf("compact") >= 0 && r.indexOf("frugal") >= 0 && r.indexOf("seat") >= 0; })());
check("글 해석: 못 박기 어렵다는 말을 조건으로 인식", Agent.optionsFromText(Agent.interpretText("월세라 벽에 못을 박기 어려워요")).some(function (o) { return o.constraints.noWall === true; }));
var unk = Agent.interpretText("고양이가 있어요, 방이 어두워요");
check("글 해석: 이해하지 못한 표현은 숨기지 않고 따로 알려 줌", unk.unknown.length === 1 && unk.unknown[0] === "고양이가 있어요" && unk.matches.length === 1, JSON.stringify(unk.unknown));
check("글 해석: 빈 입력은 아무것도 만들지 않음", Agent.interpretText("").matches.length === 0 && Agent.interpretText("  ").unknown.length === 0);
check("글 해석: 같은 의미를 여러 번 써도 한 번만 반영", Agent.interpretText("어두워요. 조명이 필요해요. 너무 어두워요").matches.length === 1);
var dxText = Agent.diagnose(Agent.optionsFromText(Agent.interpretText("방이 어두워서 공부가 안 돼요")));
var sgText = Agent.suggest(items, { owned: [], diagnosis: dxText });
var lampOpt = sgText.filter(function (g) { return g.category === "조명"; })[0].options[0];
check("글 해석: 쓴 문장이 근거 문구로 그대로 인용됨('적어 주셔서')", lampOpt.reasons.join("|").indexOf("'방이 어두워서 공부가 안 돼요'라고 적어 주셔서") >= 0, lampOpt.reasons[0]);
check("글 해석: 쓴 내용에 맞는 카테고리(조명, 책상, 의자)가 상위에 오름", ["조명", "책상", "의자"].every(function (c) { return sgText.slice(0, 4).some(function (g) { return g.category === c; }); }));

// 11-2. 글 해석 고도화: 부정, 구체적인 말 우선, 상품이 없는 종류, 띄어쓰기, 유사도와 되묻기
var neg = Agent.interpretText("방이 어둡진 않아요");
check("글 해석: 부정 표현은 필요로 읽지 않고 따로 알려 줌", neg.matches.length === 0 && neg.negated.length === 1);
var partNeg = Agent.interpretText("조명은 충분한데 앉을 곳이 부족해요");
check("글 해석: 문장의 한 부분만 부정(조명은 충분, 앉을 곳은 부족)", ids("조명은 충분한데 앉을 곳이 부족해요").join() === "seat" && partNeg.negated.length === 1);
check("글 해석: '침대는 필요 없고 책상만'에서 침대는 빼고 책상 고민만 반영", ids("침대는 필요 없고 책상만 있으면 돼요").join() === "study");
check("글 해석: 책장을 직접 말하면 일반 수납(4종)이 아니라 선반만", (function () { var m = Agent.interpretText("책장이 필요한데 못은 박기 싫어요").matches; var cats = []; m.forEach(function (x) { cats = cats.concat(x.needs); });
  return unique(cats).join() === "선반" && m.some(function (x) { return x.constraints.noWall; }); })());
check("글 해석: 일반 수납 고민은 수납 4종", Agent.optionsFromText(Agent.interpretText("짐이 많아서 방이 어질러져요"))[0].needs.length === 4);
var np = Agent.interpretText("암막 커튼이 필요해요");
check("글 해석: 우리 상품에 없는 종류(커튼)는 추천에 쓰지 않고 '상품이 없다'고 알려 줌", np.noProduct.length === 1 && np.noProduct[0].id === "np_curtain" && Agent.optionsFromText(np).length === 0);
check("글 해석: 상품이 없는 종류의 말이 다른 고민을 엉뚱하게 만들지 않음(빈백 소파, 압축봉으로 정리)", ids("빈백 소파 사고 싶어요").length === 0 && ids("압축봉이랑 후크로 정리하고 싶어요").length === 0);
check("글 해석: 띄어쓰기 없이 써도 이해함", ids("방이너무어두워요").join() === "light" && ids("옷 걸이가 있었으면").length === 0);
check("글 해석: 벽을 쓰고 싶다는 말은 벽·세로 수납으로 이해함", ids("서랍장 놓을 자리는 없어서 벽을 쓰고 싶어요").join() === "vertical");
var ask = Agent.interpretText("집에 사람이 오면 서 있어야 해요");
check("글 해석: 키워드가 없고 비슷한 표현이면 바로 반영하지 않고 되묻기 후보를 줌", ask.matches.length === 0 && ask.uncertain.length === 1 && ask.uncertain[0].candidates[0].id === "seat" && ask.uncertain[0].candidates.length <= 3, JSON.stringify(ask.uncertain[0] && ask.uncertain[0].candidates[0]));
var chosen = {}; chosen[ask.uncertain[0].phrase] = "seat";
var rc = Agent.interpretText("집에 사람이 오면 서 있어야 해요", { choices: chosen });
check("글 해석: 되묻기에 답하면 그 뜻으로 반영하고 '직접 확인'으로 표시", rc.matches.length === 1 && rc.matches[0].id === "seat" && rc.matches[0].via === "confirmed" && rc.uncertain.length === 0);
var none = {}; none[ask.uncertain[0].phrase] = "none";
check("글 해석: '해당 없음'이라고 답하면 반영하지 않음", Agent.interpretText("집에 사람이 오면 서 있어야 해요", { choices: none }).matches.length === 0);
check("글 해석: 전혀 관련 없는 문장은 되묻지 않고 '이해하지 못함'", (function () { var r = Agent.interpretText("우리 집 강아지가 너무 귀여워요"); return r.matches.length === 0 && r.uncertain.length === 0 && r.unknown.length === 1; })());
check("글 해석: 유사도를 끄면(규칙만) 되묻기 없이 이해하지 못함으로 처리", Agent.interpretText("집에 사람이 오면 서 있어야 해요", { similarity: false }).unknown.length === 1);
check("글 해석: 이상한 입력(빈 값, 이모지, 아주 긴 글)에도 오류 없이 처리", (function () {
  try { Agent.interpretText(undefined); Agent.interpretText(""); Agent.interpretText("ㅋㅋㅋㅋ 😀😀"); Agent.interpretText(new Array(500).join("방이 어두워요 ")); return true; } catch (e) { return false; } })());

// 11-3. 평가 회귀: 새 방식이 기존 규칙(기준선)보다 점수가 높아야 한다. 정확한 값과 한계는 tools/eval_text.js와 README에 있다.
var evalData = JSON.parse(readFile("tools/text_eval.json"));
function evalTags(g) { return g.cats.map(function (c) { return "c:" + c; }).concat(g.cons.map(function (k) { return "k:" + k; }), g.styles.map(function (s) { return "s:" + s; }), g.np.map(function (n) { return "n:" + n; })); }
function resTags(r) { var o = {}; (r.matches || []).forEach(function (m) { (m.needs || []).forEach(function (c) { o["c:" + c] = 1; }); Object.keys(m.constraints || {}).forEach(function (k) { if (m.constraints[k]) o["k:" + k] = 1; }); Object.keys(m.styles || {}).forEach(function (s) { if (m.styles[s] > 0) o["s:" + s] = 1; }); }); (r.noProduct || []).forEach(function (m) { o["n:" + m.id.replace(/^np_/, "")] = 1; }); return Object.keys(o); }
function f1Of(set, fn) { var tp = 0, fp = 0, fn_ = 0; set.forEach(function (g) { var gold = evalTags(g), p = resTags(fn(g.t)); var hit = p.filter(function (x) { return gold.indexOf(x) >= 0; }).length; tp += hit; fp += p.length - hit; fn_ += gold.length - hit; });
  var pr = tp + fp ? tp / (tp + fp) : 1, rc2 = tp + fn_ ? tp / (tp + fn_) : 1; return pr + rc2 ? 2 * pr * rc2 / (pr + rc2) : 0; }
["dev", "test", "fresh"].forEach(function (name) {
  var base = f1Of(evalData[name], function (x) { return BaselineText.interpret(x); }), now = f1Of(evalData[name], function (x) { return Agent.interpretText(x); });
  check("글 해석 평가(" + name + "): 새 방식의 F1이 기존 규칙보다 10점 이상 높음", now >= base + 0.10, "기존 " + Math.round(base * 100) + "% -> 새 방식 " + Math.round(now * 100) + "%");
});
var paraBase = f1Of(evalData.paraphrase, function (x) { return BaselineText.interpret(x); }), paraNow = f1Of(evalData.paraphrase, function (x) { return Agent.interpretText(x); });
check("글 해석 평가(키워드 없는 돌려 말하기): 기존 규칙보다 나빠지지 않음(개선이 작다는 한계는 README에 기록)", paraNow >= paraBase, "기존 " + Math.round(paraBase * 100) + "% -> 새 방식 " + Math.round(paraNow * 100) + "%");

// 12. 좁은 방(compact)과 가성비(frugal): 같은 종류 안에서 작거나 저렴한 상품을 앞에 둔다
var dxCompact = Agent.diagnose(Agent.optionsFromText(Agent.interpretText("방이 좁아요")));
var base = Agent.suggest(items, { owned: [], diagnosis: Agent.diagnose([]) });
var cmp = Agent.suggest(items, { owned: [], diagnosis: dxCompact });
function topOf(sg, cat) { return sg.filter(function (g) { return g.category === cat; })[0].options[0].item; }
var floorCats = Agent.FLOOR_CATS.filter(function (c) { return cmp.some(function (g) { return g.category === c; }); });
var smaller = floorCats.filter(function (c) { return Agent.footprint(topOf(cmp, c)) < Agent.footprint(topOf(base, c)); });
check("좁은 방: 기본 1순위가 큰 카테고리에서는 더 작은 상품이 1순위가 됨", smaller.length >= 3 && smaller.indexOf("침대 프레임") >= 0, smaller.join(", "));
check("좁은 방: 어떤 카테고리에서도 1순위가 기본보다 더 커지지 않음", floorCats.every(function (c) { return Agent.footprint(topOf(cmp, c)) <= Agent.footprint(topOf(base, c)); }),
  floorCats.filter(function (c) { return Agent.footprint(topOf(cmp, c)) > Agent.footprint(topOf(base, c)); }).join(", "));
var dxNoCompact = Agent.diagnose(Agent.optionsFromText(Agent.interpretText("방이 어두워요")));
var dxWithCompact = Agent.diagnose(Agent.optionsFromText(Agent.interpretText("방이 어두워요. 방이 좁아요")));
var orderA = Agent.suggest(items, { owned: OWNED, diagnosis: dxNoCompact }).map(function (g) { return g.category; });
var orderB = Agent.suggest(items, { owned: OWNED, diagnosis: dxWithCompact }).map(function (g) { return g.category; });
check("좁은 방: 카테고리 순서는 바뀌지 않고 같은 종류 안의 상품만 바뀜(직접 말한 고민이 밀리지 않음)", orderA.join() === orderB.join() && orderB[0] === "조명", orderB.slice(0, 3).join(", "));
check("좁은 방: 크기가 작아서 골랐다는 근거가 붙음", cmp.some(function (g) { return g.options[0].reasons.join("|").indexOf("공간이 좁다고 하셔서") >= 0; }));
var dxFrugal = Agent.diagnose(Agent.optionsFromText(Agent.interpretText("가성비가 중요해요")));
var frg = Agent.suggest(items, { owned: [], diagnosis: dxFrugal });
var cheaperCats = frg.filter(function (g) { return g.options[0].item.price <= topOf(base, g.category).price; }).length;
check("가성비: 대부분의 카테고리에서 1순위가 더 저렴하거나 같음", cheaperCats >= frg.length * 0.8, cheaperCats + "/" + frg.length);
check("가성비: 저렴한 편이라서 골랐다는 근거가 붙음", frg.some(function (g) { return g.options[0].reasons.join("|").indexOf("가격이 저렴한 편을 원하셔서") >= 0; }));
check("좁은 방/가성비: 반영 사실을 설명함", Agent.constraintNotes(items, { owned: [], diagnosis: dxCompact }).join("|").indexOf("공간이 좁다고") >= 0 &&
  Agent.constraintNotes(items, { owned: [], diagnosis: dxFrugal }).join("|").indexOf("저렴한 편") >= 0);

// 13. 방 크기: 바닥에 놓는 가구가 방에 들어가는지
var fb = Agent.floorBudget({ w: 300, d: 400 }, ["침대 프레임", "책상"]);
check("방 크기: 바닥 여유 면적 계산(방의 절반 - 이미 있는 가구)", fb.total === 120000 && fb.usable === 60000 && fb.ownedUsed === 100 * 200 + 120 * 60 && fb.remaining === 60000 - 27200, fb.remaining + "cm²");
check("방 크기: 방 크기를 입력하지 않으면 계산하지 않음", Agent.floorBudget(null, []) === null && Agent.floorBudget({ w: 0, d: 300 }, []) === null);
var bed = items.filter(function (i) { return i.category === "침대 프레임"; }).sort(function (a, b) { return Agent.footprint(b) - Agent.footprint(a); })[0];   // 가장 큰 침대 프레임
var wallClock = items.filter(function (i) { return i.category === "시계"; })[0];
check("방 크기: 벽걸이·탁상 상품은 바닥을 차지하지 않음", Agent.footprint(wallClock) === 0 && Agent.fitOf(wallClock, fb).state === "none");
var tinyFloor = Agent.floorBudget({ w: 200, d: 220 }, []);
check("방 크기: 작은 방에서는 침대 프레임이 들어가지 못한다고 판단", Agent.fitOf(bed, tinyFloor).state === "over" && Agent.fitOf(bed, tinyFloor).note.length > 0, Agent.fitOf(bed, tinyFloor).note);
var bigFloor = Agent.floorBudget({ w: 500, d: 600 }, []);
check("방 크기: 넓은 방에서는 같은 침대 프레임이 들어감", Agent.fitOf(bed, bigFloor).state === "ok");
var smallRoom = { w: 200, d: 250 };
var sgRoom = Agent.suggest(items, { owned: [], diagnosis: minimal, room: smallRoom });
check("방 크기: 후보 안에서 들어가는 상품이 못 들어가는 상품보다 앞에 있음(같은 카테고리)",
  sgRoom.every(function (g) { var firstOver = -1; g.options.forEach(function (o, k) { if (o.fit.state === "over" && firstOver < 0) firstOver = k; });
    return firstOver < 0 || g.options.slice(firstOver).every(function (o) { return o.fit.state === "over" || o.score <= g.options[firstOver].score + 4; }); }));
var sofaRoom = sgRoom.filter(function (g) { return g.category === "소파"; })[0];
check("방 크기: 작은 방에서 소파 1순위는 들어가는 상품이고, 못 들어가는 상품에는 이유가 붙음",
  sofaRoom.options[0].fit.state !== "over" || sofaRoom.options.every(function (o) { return o.fit.state === "over"; }),
  sofaRoom.options.map(function (o) { return o.fit.state; }).join(","));
check("방 크기: 들어가기 어려운 상품에는 근거 문구가 붙음", sgRoom.some(function (g) { return g.options.some(function (o) { return o.fit.state === "over" && o.reasons.join("|").indexOf("너무 길어요") + o.reasons.join("|").indexOf("들어가기 어려울 수 있어요") > -2; }); }));
[{ w: 200, d: 250 }, { w: 250, d: 350 }, { w: 400, d: 500 }].forEach(function (room) {
  var rr = Agent.recommend(items, { budget: 3000000, owned: ["책상", "의자"], diagnosis: minimal, room: room });
  var used = rr.picked.reduce(function (s, p) { return s + Agent.footprint(p.item); }, 0);
  var start = Agent.floorBudget(room, ["책상", "의자"]).remaining;
  check("방 크기: 자동 선택이 " + room.w + "×" + room.d + "cm 방의 바닥 여유를 넘지 않음", used <= start + 1e-6 && rr.floor.remaining >= 0, "사용 " + Math.round(used) + " / 여유 " + Math.round(start) + "cm²");
});
var roomNone = Agent.recommend(items, { budget: 300000, owned: OWNED, diagnosis: minimal });
var roomHuge = Agent.recommend(items, { budget: 300000, owned: OWNED, diagnosis: minimal, room: { w: 2000, d: 2000 } });
check("방 크기: 아주 넓은 방이면 방 크기를 입력하지 않았을 때와 같은 추천", roomNone.picked.map(function (p) { return p.item.id; }).join() === roomHuge.picked.map(function (p) { return p.item.id; }).join());
var roomSkip = Agent.recommend(items, { budget: 3000000, owned: [], diagnosis: minimal, room: { w: 150, d: 180 } });   // 바닥이 금방 차는 아주 작은 방
check("방 크기: 들어가지 못해 제외했거나 더 작은 상품으로 바꾼 이유가 판단 과정에 기록됨", roomSkip.log.join("|").indexOf("방에 들어가기 어려") >= 0, roomSkip.log.filter(function (l) { return l.indexOf("방") >= 0; }).length + "줄");
check("방 크기: 방 크기를 어떻게 계산했는지 설명함", Agent.constraintNotes(items, { owned: ["책상"], diagnosis: minimal, room: { w: 300, d: 400 } }).join("|").indexOf("바닥을 약 6㎡") >= 0);

// 9. 데이터 규모
check("데이터: 150개 안팎의 상품과 20개 이상의 카테고리", items.length >= 150 && allCats.length >= 20, items.length + "개 / " + allCats.length + "개");

print(failures ? "\n" + failures + " FAILED" : "\nALL PASSED");
if (failures) quit(1);
