// 직접 쓴 글 해석의 정확도를 측정한다. 실행: jsc tools/eval_text.js            (요약)
//                                          jsc tools/eval_text.js -- -v         (틀린 문장 목록까지)
// 정답은 문장마다 사람이 붙인 태그(추천할 카테고리 c:, 조건 k:, 취향 s:, 상품이 없는 종류 n:)이다.
load("tools/text_baseline.js");
load("agent/agent.js");
var data = JSON.parse(readFile("tools/text_eval.json"));
var VERBOSE = typeof arguments !== "undefined" && arguments.indexOf("-v") >= 0;

function goldTags(g) {
  return g.cats.map(function (c) { return "c:" + c; }).concat(g.cons.map(function (k) { return "k:" + k; }),
    g.styles.map(function (s) { return "s:" + s; }), g.np.map(function (n) { return "n:" + n; }));
}
function resultTags(r, extra) {
  var tags = {};
  (r.matches || []).concat(extra || []).forEach(function (m) {
    (m.needs || []).forEach(function (c) { tags["c:" + c] = 1; });
    Object.keys(m.constraints || {}).forEach(function (k) { if (m.constraints[k]) tags["k:" + k] = 1; });
    Object.keys(m.styles || {}).forEach(function (s) { if (m.styles[s] > 0) tags["s:" + s] = 1; });
  });
  (r.noProduct || []).forEach(function (m) { tags["n:" + m.id.replace(/^np_/, "")] = 1; });
  return Object.keys(tags);
}
function evaluate(set, predict) {
  var tp = 0, fp = 0, fn = 0, exact = 0, asks = 0, wrong = [];
  set.forEach(function (g) {
    var gold = goldTags(g), p = predict(g);
    var predicted = p.tags; asks += p.asks || 0;
    var hit = predicted.filter(function (t) { return gold.indexOf(t) >= 0; });
    tp += hit.length; fp += predicted.length - hit.length; fn += gold.length - hit.length;
    if (hit.length === gold.length && predicted.length === gold.length) exact++;
    else wrong.push({ t: g.t, missing: gold.filter(function (t) { return predicted.indexOf(t) < 0; }), extra: predicted.filter(function (t) { return gold.indexOf(t) < 0; }) });
  });
  var prec = tp + fp ? tp / (tp + fp) : 1, rec = tp + fn ? tp / (tp + fn) : 1;
  return { n: set.length, precision: prec, recall: rec, f1: prec + rec ? 2 * prec * rec / (prec + rec) : 0, exact: exact / set.length, asks: asks, wrong: wrong };
}
function pct(x) { return (x * 100).toFixed(0) + "%"; }

// 되묻기(C)의 상한선: 사용자가 되묻기 후보 중 알맞은 것을 항상 고른다고 가정한다(알맞은 후보가 없으면 "해당 없음")
function oracleTags(g, text) {
  var gold = goldTags(g), r = Agent.interpretText(text), asks = 0, extra = [];
  r.uncertain.forEach(function (u) {
    asks++;
    var pick = u.candidates.filter(function (c) {
      var m = Agent.interpretText(u.phrase, { choices: (function () { var o = {}; o[u.phrase] = c.id; return o; })() });
      var t = resultTags(m); return t.length && t.every(function (x) { return gold.indexOf(x) >= 0; });
    })[0];
    if (pick) { var o = {}; o[u.phrase] = pick.id; extra = extra.concat(resultTags(Agent.interpretText(u.phrase, { choices: o }))); }
  });
  var tags = resultTags(r); extra.forEach(function (t) { if (tags.indexOf(t) < 0) tags.push(t); });
  return { tags: tags, asks: asks };
}
var MODES = [
  { name: "기존 규칙(기준선)            ", predict: function (g) { return { tags: resultTags(BaselineText.interpret(g.t)) }; } },
  { name: "A 규칙 보강(부정·구체 우선)  ", predict: function (g) { return { tags: resultTags(Agent.interpretText(g.t, { similarity: false })) }; } },
  { name: "A+B 예시 문장 유사도         ", predict: function (g) { return { tags: resultTags(Agent.interpretText(g.t)) }; } },
  { name: "A+B+C 되묻기(사용자가 고름)  ", predict: function (g) { return oracleTags(g, g.t); } }
];

var SET_LABEL = { dev: "튜닝용(dev)", test: "검증용(test, 규칙을 쓸 때 문장을 봐서 참고용)", fresh: "신규(fresh, 규칙 확정 후 새로 씀)", paraphrase: "돌려 말하기(paraphrase, 키워드 없음, 아직 조정 안 함)" };
["dev", "test", "fresh", "paraphrase"].forEach(function (setName) {
  print("\n== " + SET_LABEL[setName] + " " + data[setName].length + "문장");
  MODES.forEach(function (m) {
    var r = evaluate(data[setName], function (g) { return m.predict(g); });
    print("  " + m.name + ": 정밀도 " + pct(r.precision) + " / 재현율 " + pct(r.recall) + " / F1 " + pct(r.f1) + " / 문장 전체 정답 " + pct(r.exact) + (r.asks ? " / 되묻기 " + r.asks + "회" : ""));
    if (VERBOSE) r.wrong.forEach(function (w) { print("      ✗ " + w.t + "  놓침:" + w.missing.join(",") + "  잘못:" + w.extra.join(",")); });
  });
});
