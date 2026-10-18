// 추천 에이전트: 취향 진단 -> 점수화 -> 예산 안에서 선택 -> 초과 시 대체/제외, 판단 과정을 기록한다.
// DOM에 의존하지 않아 브라우저와 tools/test_agent.js(jsc)에서 같은 코드를 쓴다.
var Agent = (function () {
  "use strict";

  var STYLES = ["미니멀", "모던", "우드", "따뜻한"];
  var MAX_PER_CATEGORY = {}; // 계열(같은 카테고리의 가격대 사슬)마다 1개만 고르므로 카테고리당 1개가 기본
  var PRIORITY_WEIGHT = { 1: 3, 2: 2, 3: 1 };
  var MAX_SHARE = 0.45;       // 한 상품이 예산의 45%를 넘으면 같은 종류의 더 저렴한 상품으로 먼저 바꿔 본다 (예산 배분)
  var MAX_PER_NEED_GROUP = 2; // 한 고민(예: 수납)이 여러 카테고리에 가점을 줘도 그 고민에서는 최대 2개만 고른다

  // 로그가 길어지지 않도록 이름은 5개까지만 보여 주고 나머지는 "외 N개"로 줄인다
  function nameList(names) {
    return names.length > 5 ? names.slice(0, 5).join(", ") + " 외 " + (names.length - 5) + "개" : names.join(", ");
  }

  function unique(list) {
    return list.filter(function (v, i) { return list.indexOf(v) === i; });
  }

  // selected: 사용자가 고른 선택지들 [{styles: {스타일: 가중치}, needs: [카테고리]}]
  function diagnose(selected) {
    var scores = {};
    var needs = [], needGroups = [];
    STYLES.forEach(function (s) { scores[s] = 0; });
    selected.forEach(function (opt) {
      Object.keys(opt.styles || {}).forEach(function (k) { scores[k] += opt.styles[k]; });
      needs = needs.concat(opt.needs || []);
      if (opt.needs && opt.needs.length) needGroups.push({ label: opt.label || "", categories: opt.needs });
    });
    var ranked = STYLES.slice().sort(function (a, b) { return scores[b] - scores[a]; });
    return {
      primary: ranked[0],
      secondary: scores[ranked[1]] > 0 ? ranked[1] : null,
      scores: scores,
      needs: unique(needs),
      needGroups: needGroups
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
    if (item.styles.indexOf(d.primary) >= 0) {
      score += 3;
      reasons.push("'" + d.primary + "' 스타일과 잘 어울려요");
    } else if (d.secondary && item.styles.indexOf(d.secondary) >= 0) {
      score += 1.5;
      reasons.push("보조 취향 '" + d.secondary + "'과 어울려요");
    }
    if (d.needs.indexOf(item.category) >= 0) {
      score += 3;
      // 사용자가 고른 건 카테고리가 아니라 '고민'이므로, 실제로 고른 답변 문구를 근거로 보여 준다
      var asked = (d.needGroups || []).filter(function (g) { return g.categories.indexOf(item.category) >= 0 && g.label; });
      reasons.push(asked.length
        ? "'" + asked[0].label + "'라고 답하셔서 관련 상품으로 골랐어요"
        : "아쉬운 점과 관련된 상품이라 우선 골랐어요");
    }
    // 퇴실 때 원상복구를 고려: 못·타공 없이 설치할 수 있으면 가점, 벽에 못이 필요하면 주의 문구
    if (item.noDrill) { score += 0.5; reasons.push("못을 박지 않고 설치할 수 있어요"); }
    else reasons.push("벽에 못이 필요할 수 있어요 (원상복구 주의)");
    return { score: score, reasons: reasons };
  }

  // 예산과 상관없이 카테고리(계열)별로 후보를 점수 순으로 정리한다. 사용자가 직접 고르는 화면용.
  // 반환: [{ category, score, options: [{ item, score, reasons }] }]  (options[0]이 그 카테고리의 1순위)
  function suggest(items, opts) {
    var d = opts.diagnosis;
    var byId = {};
    items.forEach(function (i) { byId[i.id] = i; });
    var groups = {};
    items.filter(function (i) { return opts.owned.indexOf(i.category) < 0; }).forEach(function (i) {
      var key = familyRoot(i, byId);
      (groups[key] = groups[key] || []).push(i);
    });
    return Object.keys(groups).map(function (key) {
      var options = groups[key].map(function (i) {
        var s = scoreItem(i, d);
        return { item: i, score: s.score, reasons: s.reasons };
      }).sort(function (a, b) { return b.score - a.score || a.item.price - b.item.price; });
      return { category: options[0].item.category, score: options[0].score, options: options };
    }).sort(function (a, b) {
      return b.score - a.score || a.options[0].item.priority - b.options[0].item.priority || a.options[0].item.price - b.options[0].item.price;
    });
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
    var groups = d.needGroups || [], groupCount = groups.map(function () { return 0; }), deferred = [];
    function groupsOf(cat) {
      var out = [];
      groups.forEach(function (g, i) { if (g.categories.indexOf(cat) >= 0) out.push(i); });
      return out;
    }

    // target을 예산 안에서 고른다. 모자라면 같은 계열의 더 저렴한 상품으로 바꾸고, 그래도 안 되면 제외한다. 골랐으면 true
    function attempt(target, extraReason) {
      var remaining = opts.budget - total;
      var chosen = null, replacedFrom = null;
      var cap = opts.budget * MAX_SHARE;
      var tooBig = target.price > cap && target.price <= remaining;  // 살 수는 있지만 예산을 너무 많이 차지하는 경우
      var lighter = tooBig ? families[familyRoot(target, byId)].filter(function (i) { return i.price < target.price && i.price <= cap; })
        .sort(function (a, b) {
          var am = a.styles.indexOf(d.primary) >= 0 ? 1 : 0;
          var bm = b.styles.indexOf(d.primary) >= 0 ? 1 : 0;
          return bm - am || b.price - a.price;
        }) : [];
      if (lighter.length) {
        chosen = lighter[0];
        replacedFrom = target;
        log.push("'" + target.name + "'은(는) 예산의 " + Math.round(target.price / opts.budget * 100) + "%라 다른 항목을 사기 어려워서, 더 저렴한 '" + chosen.name + "'(으)로 바꿨어요 (" + (target.price - chosen.price).toLocaleString("ko-KR") + "원 절약)");
      } else if (target.price <= remaining) {
        chosen = target;
      } else {
        var cheaper = families[familyRoot(target, byId)].filter(function (i) {
          return i.price < target.price && i.price <= remaining;
        }).sort(function (a, b) {
          var am = a.styles.indexOf(d.primary) >= 0 ? 1 : 0;
          var bm = b.styles.indexOf(d.primary) >= 0 ? 1 : 0;
          return bm - am || b.price - a.price;
        });
        if (!cheaper.length) {
          skipped.push({ item: target, reason: "남은 예산 " + remaining.toLocaleString("ko-KR") + "원으로는 살 수 없어요 (" + target.price.toLocaleString("ko-KR") + "원 필요)" });
          return false;
        }
        chosen = cheaper[0];
        replacedFrom = target;
        log.push("예산이 모자라 '" + target.name + "' 대신 더 저렴한 '" + chosen.name + "'(으)로 바꿨어요 (" + (target.price - chosen.price).toLocaleString("ko-KR") + "원 절약)");
      }
      groupsOf(chosen.category).forEach(function (i) { groupCount[i]++; });
      perCategory[chosen.category] = (perCategory[chosen.category] || 0) + 1;
      total += chosen.price;
      var reasons = scored[chosen.id].reasons.slice();
      if (extraReason) reasons.push(extraReason);
      picked.push({ item: chosen, reasons: reasons, replacedFrom: replacedFrom });
      return true;
    }

    targets.forEach(function (target) {
      var max = MAX_PER_CATEGORY[target.category] || 1;
      if ((perCategory[target.category] || 0) >= max) return;
      var gs = groupsOf(target.category);
      if (gs.length && gs.every(function (i) { return groupCount[i] >= MAX_PER_NEED_GROUP; })) { deferred.push(target); return; }
      attempt(target);
    });

    // 한 고민 상한 때문에 미뤄 둔 항목은 다른 항목을 다 채운 뒤 남은 예산으로 추가한다
    if (deferred.length) {
      var added = [], left = [];
      deferred.forEach(function (t) {
        if (attempt(t, "다른 항목을 먼저 채우고 남은 예산으로 추가했어요")) added.push(t.name); else left.push(t.name);
      });
      log.push("한 고민(예: 수납)에서는 " + MAX_PER_NEED_GROUP + "개까지만 먼저 골랐어요. 뒤로 미룬 항목: " +
        nameList(deferred.map(function (t) { return t.name; })) +
        (added.length ? " / 남은 예산으로 추가: " + nameList(added) : "") +
        (left.length ? " / 예산이 부족해 못 고름: " + nameList(left) : ""));
    }
    if (skipped.length) {
      log.push("예산이 부족해 제외한 항목 " + skipped.length + "개: " + nameList(skipped.map(function (s) { return s.item.name; })));
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

  return { STYLES: STYLES, diagnose: diagnose, suggest: suggest, recommend: recommend };
})();
