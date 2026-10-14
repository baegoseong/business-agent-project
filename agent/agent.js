// 추천 에이전트: 취향 진단 -> 점수화 -> 예산 안에서 선택 -> 초과 시 대체/제외, 판단 과정을 기록한다.
// DOM에 의존하지 않아 브라우저와 tools/test_agent.js(jsc)에서 같은 코드를 쓴다.
var Agent = (function () {
  "use strict";

  var STYLES = ["미니멀", "모던", "우드", "따뜻한"];
  var MAX_PER_CATEGORY = { "수납": 2, "소품": 2 }; // 나머지 카테고리는 1개
  var PRIORITY_WEIGHT = { 1: 3, 2: 2, 3: 1 };

  function unique(list) {
    return list.filter(function (v, i) { return list.indexOf(v) === i; });
  }

  // selected: 사용자가 고른 선택지들 [{styles: {스타일: 가중치}, needs: [카테고리]}]
  function diagnose(selected) {
    var scores = {};
    var needs = [];
    STYLES.forEach(function (s) { scores[s] = 0; });
    selected.forEach(function (opt) {
      Object.keys(opt.styles || {}).forEach(function (k) { scores[k] += opt.styles[k]; });
      needs = needs.concat(opt.needs || []);
    });
    var ranked = STYLES.slice().sort(function (a, b) { return scores[b] - scores[a]; });
    return {
      primary: ranked[0],
      secondary: scores[ranked[1]] > 0 ? ranked[1] : null,
      scores: scores,
      needs: unique(needs)
    };
  }

  // alternativeTo를 따라 올라가 같은 계열(가격만 다른 대체 관계)의 대표 id를 구한다.
  function familyRoot(item, byId) {
    var cur = item;
    var guard = 0;
    while (cur.alternativeTo && byId[cur.alternativeTo] && guard++ < 20) cur = byId[cur.alternativeTo];
    return cur.id;
  }

  function scoreItem(item, d) {
    var score = PRIORITY_WEIGHT[item.priority];
    var reasons = [];
    if (item.priority === 1) reasons.push("방을 쓰는 데 가장 먼저 필요한 기본 아이템이에요");
    if (item.styles.indexOf(d.primary) >= 0) {
      score += 3;
      reasons.push("'" + d.primary + "' 스타일과 잘 어울려요");
    } else if (d.secondary && item.styles.indexOf(d.secondary) >= 0) {
      score += 1.5;
      reasons.push("보조 취향 '" + d.secondary + "'과 어울려요");
    }
    if (d.needs.indexOf(item.category) >= 0) {
      score += 3;
      reasons.push("'" + item.category + "'이(가) 아쉽다고 해서 우선 골랐어요");
    }
    if (!reasons.length) reasons.push("전체 구성을 채우는 데 필요해요");
    return { score: score, reasons: reasons };
  }

  // opts: { budget, owned: [카테고리], diagnosis }
  function recommend(items, opts) {
    var d = opts.diagnosis;
    var byId = {};
    items.forEach(function (i) { byId[i.id] = i; });

    var pool = items.filter(function (i) { return opts.owned.indexOf(i.category) < 0; });
    var scored = {};
    pool.forEach(function (i) { scored[i.id] = scoreItem(i, d); });

    // 계열마다 점수가 가장 높은 대표 후보 1개만 올린다 (같은 물건의 비싼/싼 버전을 중복 추천하지 않기 위해)
    var families = {};
    pool.forEach(function (i) {
      var key = familyRoot(i, byId);
      (families[key] = families[key] || []).push(i);
    });
    var targets = Object.keys(families).map(function (key) {
      return families[key].slice().sort(function (a, b) {
        return scored[b.id].score - scored[a.id].score || a.price - b.price;
      })[0];
    }).sort(function (a, b) {
      return scored[b.id].score - scored[a.id].score || a.priority - b.priority || a.price - b.price;
    });

    var picked = [], skipped = [], log = [], perCategory = {}, total = 0;

    targets.forEach(function (target) {
      var max = MAX_PER_CATEGORY[target.category] || 1;
      if ((perCategory[target.category] || 0) >= max) return;
      var remaining = opts.budget - total;
      var chosen = null, replacedFrom = null;

      if (target.price <= remaining) {
        chosen = target;
      } else {
        var cheaper = families[familyRoot(target, byId)].filter(function (i) {
          return i.price < target.price && i.price <= remaining;
        }).sort(function (a, b) {
          var am = a.styles.indexOf(d.primary) >= 0 ? 1 : 0;
          var bm = b.styles.indexOf(d.primary) >= 0 ? 1 : 0;
          return bm - am || b.price - a.price;
        });
        if (cheaper.length) {
          chosen = cheaper[0];
          replacedFrom = target;
          log.push("예산이 모자라 '" + target.name + "' 대신 더 저렴한 '" + chosen.name + "'(으)로 바꿨어요 (" + (target.price - chosen.price).toLocaleString("ko-KR") + "원 절약)");
        } else {
          skipped.push({ item: target, reason: "남은 예산 " + remaining.toLocaleString("ko-KR") + "원으로는 살 수 없어요 (" + target.price.toLocaleString("ko-KR") + "원 필요)" });
          return;
        }
      }

      perCategory[chosen.category] = (perCategory[chosen.category] || 0) + 1;
      total += chosen.price;
      picked.push({ item: chosen, reasons: scored[chosen.id].reasons, replacedFrom: replacedFrom });
    });

    if (skipped.length) {
      log.push("예산이 부족해 제외한 항목 " + skipped.length + "개: " + skipped.map(function (s) { return s.item.name; }).join(", "));
    }

    var minPrice = pool.length ? Math.min.apply(null, pool.map(function (i) { return i.price; })) : 0;
    return {
      picked: picked,
      skipped: skipped,
      log: log,
      total: total,
      budget: opts.budget,
      leftover: opts.budget - total,
      tooLow: picked.length === 0 && pool.length > 0,
      nothingToBuy: pool.length === 0,
      minPrice: minPrice
    };
  }

  return { STYLES: STYLES, diagnose: diagnose, recommend: recommend };
})();
