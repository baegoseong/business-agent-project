// 추천 에이전트: 사용자의 입력(고른 사진, 아쉬운 점, 직접 쓴 글, 조건, 방 크기)을 해석해 취향을 진단하고,
// 후보를 점수화해 예산과 방 크기 안에서 고르며, 판단 과정을 사람이 읽을 문장으로 남긴다.
// DOM에 의존하지 않아 브라우저와 tools/test_agent.js(jsc)에서 같은 코드를 쓴다.
var Agent = (function () {
  "use strict";

  var STYLES = ["미니멀", "모던", "우드", "따뜻한"];
  var MAX_PER_CATEGORY = {}; // 계열(같은 카테고리의 가격대 사슬)마다 1개만 고르므로 카테고리당 1개가 기본
  var PRIORITY_WEIGHT = { 1: 3, 2: 2, 3: 1 };
  var MAX_SHARE = 0.45;       // 한 상품이 예산의 45%를 넘으면 같은 종류의 더 저렴한 상품으로 먼저 바꿔 본다 (예산 배분)
  var COMPACT_WEIGHT = 4;     // 좁은 방이라고 직접 말했다면 같은 종류 중 작은 상품을 스타일 일치(+3)보다 강하게 앞에 둔다
  var MAX_PER_NEED_GROUP = 2; // 한 고민(예: 수납)이 여러 카테고리에 가점을 줘도 그 고민에서는 최대 2개만 고른다

  // ---- 방 크기: 바닥에 놓는 가구만 바닥 면적을 차지한다고 본다
  var FLOOR_CATS = ["의자", "소파", "스툴", "벤치", "테이블", "책상", "침대 프레임", "선반", "수납장", "신발 선반"];
  var USABLE_FLOOR = 0.5;     // 통로와 움직일 공간을 빼고, 방 바닥의 절반까지만 가구를 둘 수 있다고 가정
  var OWNED_FOOTPRINT = {     // 이미 있다고 체크한 가구가 차지하는 면적(cm²): 정확한 크기를 모르므로 일반적인 크기로 가정
    "침대 프레임": 100 * 200, "책상": 120 * 60, "의자": 45 * 45, "스툴": 40 * 40, "선반": 60 * 30, "수납장": 60 * 40
  };
  var TOO_LONG_MARGIN = 20;   // 가구의 긴 변이 방의 긴 변보다 이만큼(cm)은 짧아야 들어간다

  // 로그가 길어지지 않도록 이름은 5개까지만 보여 주고 나머지는 "외 N개"로 줄인다
  function nameList(names) {
    return names.length > 5 ? names.slice(0, 5).join(", ") + " 외 " + (names.length - 5) + "개" : names.join(", ");
  }

  function unique(list) {
    return list.filter(function (v, i) { return list.indexOf(v) === i; });
  }

  function m2(cm2) { return Math.round(cm2 / 100) / 100; }   // cm² -> ㎡ (소수 둘째 자리)

  // ======================================================================
  // 1. 입력 해석: 고른 사진, 직접 쓴 글 -> 진단에 넣을 선택지(options)
  // ======================================================================

  // 취향을 묻는 방 분위기 사진: data/moods.json의 항목(오늘의집 스타일 이름 + 사진 + 우리 네 가지 취향으로 환산한 가중치).
  // 사용자가 고른 분위기 -> 진단에 넣을 선택지
  function styleOptionsFromMoods(moods) {
    return moods.map(function (m) { return { label: m.title, styles: m.styles, source: "mood" }; });
  }

  // 직접 쓴 글을 키워드 규칙으로 해석한다. LLM이 아니라 정해진 단어 목록이라 모든 표현을 이해하지는 못한다.
  // 각 규칙: 정규식(re), 보여 줄 의미(meaning), 반영할 필요 카테고리(needs) / 스타일(styles) / 조건(constraints)
  var TEXT_RULES = [
    { id: "light", re: /어둡|어두|조명|불빛|밝게|램프|스탠드|침침|눈이 아|눈 아/, meaning: "조명이 필요해요", needs: ["조명"] },
    { id: "storage", re: /수납|정리|어질러|어지러|짐이|물건이 많|물건 둘|서랍|책이 많|책 정리|책장/, meaning: "수납이 필요해요", needs: ["선반", "수납장", "수납 박스", "바구니"] },
    { id: "clothes", re: /옷이 많|옷 정리|옷장|행거|옷걸이|옷 둘/, meaning: "옷 수납이 필요해요", needs: ["수납장", "선반", "수납 박스"] },
    { id: "shoes", re: /신발|현관/, meaning: "신발·현관 정리가 필요해요", needs: ["신발 선반", "벤치"] },
    { id: "study", re: /공부|책상|작업|노트북|재택|과제|시험|레포트|리포트|컴퓨터/, meaning: "공부·작업 공간이 필요해요", needs: ["책상", "의자", "조명"] },
    { id: "seat", re: /앉|소파|의자|손님|친구가|친구 오|휴식|쉴 곳|쉬는/, meaning: "앉을 곳이 필요해요", needs: ["소파", "의자", "스툴", "벤치"] },
    { id: "sleep", re: /침대|침구|이불|잠자|수면|숙면|푹신|매트/, meaning: "잠자리를 보강하고 싶어요", needs: ["침대 프레임", "침구"] },
    { id: "floor", re: /바닥|러그|카펫|차갑|발이 시|층간|소음/, meaning: "바닥을 보강하고 싶어요", needs: ["러그"] },
    { id: "empty", re: /허전|휑|삭막|꾸미|꾸며|분위기|감성|인테리어 소품/, meaning: "방을 채우는 소품이 필요해요", needs: ["꽃병", "화분", "벽장식", "시계", "거울", "쿠션", "소품"] },
    { id: "plant", re: /식물|화분|초록|플랜테리어/, meaning: "식물·화분을 두고 싶어요", needs: ["화분", "꽃병"] },
    { id: "mirror", re: /거울|전신|외출 준비|화장/, meaning: "거울이 필요해요", needs: ["거울"] },
    { id: "clock", re: /시계|시간 확인|알람/, meaning: "시계가 필요해요", needs: ["시계"] },
    { id: "table", re: /테이블|식탁|밥 먹|커피|협탁|탁자|간식/, meaning: "테이블이 필요해요", needs: ["테이블"] },
    { id: "cushion", re: /쿠션|포근|아늑/, meaning: "포근한 느낌이 필요해요", needs: ["쿠션"], styles: { "따뜻한": 2 } },
    { id: "warm", re: /따뜻|감성|빈티지|코지/, meaning: "따뜻한 분위기를 원해요", styles: { "따뜻한": 2 } },
    { id: "wood", re: /우드|원목|나무|내추럴|자연/, meaning: "나무 질감을 원해요", styles: { "우드": 2 } },
    { id: "minimal", re: /깔끔|심플|미니멀|화이트|정돈|단순/, meaning: "깔끔한 분위기를 원해요", styles: { "미니멀": 2 } },
    { id: "modern", re: /모던|세련|도시|블랙|모노|시크/, meaning: "세련된 분위기를 원해요", styles: { "모던": 2 } },
    { id: "nail", re: /못.*(박|안|어렵|안돼)|원상복구|월세|보증금|벽에.*구멍|구멍.*안/, meaning: "벽에 못을 박기 어려워요", constraints: { noWall: true } },
    { id: "compact", re: /좁|작은 방|협소|공간이 부족|공간 부족|답답|여유가 없/, meaning: "공간이 좁아서 작은 가구가 좋아요", constraints: { compact: true } },
    { id: "frugal", re: /저렴|가성비|싸게|싼|알뜰|돈이 없|예산이 적|절약|아끼/, meaning: "가격이 저렴한 편을 원해요", constraints: { frugal: true } }
  ];

  // 반환: { matches: [{ id, phrase, meaning, needs, styles, constraints }], unknown: [문장] }
  function interpretText(text) {
    var out = { matches: [], unknown: [] };
    var clauses = String(text || "").split(/[,.\n!?;·]+|\s+(?:그리고|그래서|근데|하지만|또는)\s+/)
      .map(function (c) { return c.trim(); }).filter(function (c) { return c.length >= 2; });
    var seen = {};
    clauses.forEach(function (clause) {
      var hit = false;
      TEXT_RULES.forEach(function (r) {
        if (!r.re.test(clause)) return;
        hit = true;
        if (seen[r.id]) return;
        seen[r.id] = true;
        out.matches.push({ id: r.id, phrase: clause, meaning: r.meaning, needs: r.needs || [], styles: r.styles || {}, constraints: r.constraints || {} });
      });
      if (!hit) out.unknown.push(clause);
    });
    return out;
  }

  // 해석 결과 -> 진단에 넣을 선택지
  function optionsFromText(interp) {
    return interp.matches.map(function (m) {
      return { label: m.phrase, source: "text", needs: m.needs, styles: m.styles, constraints: m.constraints };
    });
  }

  // ======================================================================
  // 2. 진단
  // ======================================================================

  // selected: [{ label, source, styles: {스타일: 가중치}, needs: [카테고리], constraints: {...} }]
  function diagnose(selected) {
    var scores = {};
    var needs = [], needGroups = [], constraints = {};
    STYLES.forEach(function (s) { scores[s] = 0; });
    selected.forEach(function (opt) {
      Object.keys(opt.styles || {}).forEach(function (k) { scores[k] += opt.styles[k]; });
      needs = needs.concat(opt.needs || []);
      if (opt.needs && opt.needs.length) needGroups.push({ label: opt.label || "", categories: opt.needs, source: opt.source || "choice" });
      Object.keys(opt.constraints || {}).forEach(function (k) { constraints[k] = opt.constraints[k]; });
    });
    var ranked = STYLES.slice().sort(function (a, b) { return scores[b] - scores[a]; });
    return {
      primary: ranked[0],
      secondary: scores[ranked[1]] > 0 ? ranked[1] : null,
      scores: scores,
      needs: unique(needs),
      needGroups: needGroups,
      constraints: constraints   // { noWall: 벽걸이 제외, compact: 작은 가구 우선, frugal: 저렴한 편 우선 }
    };
  }

  // ======================================================================
  // 3. 방 크기와 바닥 면적
  // ======================================================================

  // 바닥에 놓는 가구가 차지하는 면적(cm²). 벽걸이, 걸이형, 탁상·소품 등은 바닥을 차지하지 않는다고 본다.
  function footprint(item) {
    return FLOOR_CATS.indexOf(item.category) >= 0 && item.mount === "place" ? item.size.w * item.size.d : 0;
  }

  // room: { w, d } (cm) 또는 null. 반환: { total, usable, ownedUsed, remaining, room } 또는 null
  function floorBudget(room, owned) {
    if (!room || !(room.w > 0) || !(room.d > 0)) return null;
    var total = room.w * room.d;
    var usable = total * USABLE_FLOOR;
    var ownedUsed = (owned || []).reduce(function (s, c) { return s + (OWNED_FOOTPRINT[c] || 0); }, 0);
    return { total: total, usable: usable, ownedUsed: ownedUsed, remaining: Math.max(0, usable - ownedUsed), room: room };
  }

  function tooLong(item, floor) {
    var longest = Math.max(item.size.w, item.size.d);
    return longest > Math.max(floor.room.w, floor.room.d) - TOO_LONG_MARGIN;
  }

  // 이 상품이 방에 들어가는지: { state: "none"|"ok"|"tight"|"over", pct, note }
  function fitOf(item, floor) {
    var fp = footprint(item);
    if (!floor || fp === 0) return { state: "none" };
    if (tooLong(item, floor)) {
      return { state: "over", note: "긴 변 " + Math.round(Math.max(item.size.w, item.size.d)) + "cm가 방 크기에 비해 너무 길어요" };
    }
    var pct = floor.remaining > 0 ? Math.round(fp / floor.remaining * 100) : 999;
    if (fp > floor.remaining) return { state: "over", pct: pct, note: "방에 들어가기 어려울 수 있어요 (남은 바닥 여유의 " + pct + "%)" };
    if (fp > floor.remaining * 0.6) return { state: "tight", pct: pct, note: "방에 비해 큰 편이에요 (남은 바닥 여유의 " + pct + "%)" };
    return { state: "ok", pct: pct };
  }

  // ======================================================================
  // 4. 점수화와 후보
  // ======================================================================

  // alternativeTo를 따라 올라가 같은 계열(가격만 다른 대체 관계)의 대표 id를 구한다.
  function familyRoot(item, byId) {
    var cur = item;
    var guard = 0;
    while (cur.alternativeTo && byId[cur.alternativeTo] && guard++ < 20) cur = byId[cur.alternativeTo];
    return cur.id;
  }

  // 같은 카테고리 안에서의 가격 순위와 바닥 면적 순위(0=가장 작음/저렴, 1=가장 큼/비쌈)
  function buildRanks(items) {
    var byCat = {}, price = {}, foot = {};
    items.forEach(function (i) { (byCat[i.category] = byCat[i.category] || []).push(i); });
    Object.keys(byCat).forEach(function (c) {
      var arr = byCat[c], n = arr.length;
      arr.slice().sort(function (a, b) { return a.price - b.price; }).forEach(function (i, k) { price[i.id] = n > 1 ? k / (n - 1) : 0.5; });
      arr.slice().sort(function (a, b) { return footprint(a) - footprint(b); }).forEach(function (i, k) { foot[i.id] = n > 1 ? k / (n - 1) : 0.5; });
    });
    return { price: price, foot: foot };
  }

  // ctx: { floor, ranks }
  function scoreItem(item, d, ctx) {
    ctx = ctx || {};
    var score = PRIORITY_WEIGHT[item.priority];
    var reasons = [];
    var cons = d.constraints || {};
    if (item.styles.indexOf(d.primary) >= 0) {
      score += 3;
      reasons.push("'" + d.primary + "' 스타일과 잘 어울려요");
    } else if (d.secondary && item.styles.indexOf(d.secondary) >= 0) {
      score += 1.5;
      reasons.push("보조 취향 '" + d.secondary + "'과 어울려요");
    }
    if (d.needs.indexOf(item.category) >= 0) {
      score += 3;
      // 사용자가 고른 건 카테고리가 아니라 '고민'이므로, 실제로 고르거나 쓴 문구를 근거로 보여 준다
      var asked = (d.needGroups || []).filter(function (g) { return g.categories.indexOf(item.category) >= 0 && g.label; });
      reasons.push(!asked.length ? "아쉬운 점과 관련된 상품이라 우선 골랐어요"
        : asked[0].source === "text" ? "'" + asked[0].label + "'라고 적어 주셔서 관련 상품으로 골랐어요"
        : "'" + asked[0].label + "'라고 답하셔서 관련 상품으로 골랐어요");
    }
    // 좁은 방, 가성비: 같은 종류 안에서 작거나 저렴한 상품에 가점. 어떤 상품을 고를지만 바꾸고 카테고리끼리의 순서는
    // 건드리지 않도록 따로 모은다(pref). 사용자가 직접 말한 고민(예: 어두워요)이 이 가점에 밀리면 안 되기 때문이다
    var pref = 0;
    // 바닥에 놓는 종류(소파, 선반 등)에만 적용한다. 같은 종류 중 걸어 쓰는 제품처럼 바닥을 안 차지하는 것은 가장 작은 쪽으로 친다
    if (cons.compact && FLOOR_CATS.indexOf(item.category) >= 0 && ctx.ranks) {
      pref += COMPACT_WEIGHT * (1 - ctx.ranks.foot[item.id]);
      if (ctx.ranks.foot[item.id] <= 0.34) reasons.push("공간이 좁다고 하셔서 같은 종류 중 작은 편의 상품이에요");
    }
    if (cons.frugal && ctx.ranks) {
      pref += 2 * (1 - ctx.ranks.price[item.id]);
      if (ctx.ranks.price[item.id] <= 0.34) reasons.push("가격이 저렴한 편을 원하셔서 같은 종류 중 저렴한 편이에요");
    }
    score += pref;
    // 방 크기: 들어가기 어려운 상품은 순위를 크게 낮추고 이유를 알려 준다
    var fit = fitOf(item, ctx.floor);
    if (fit.state === "over") { score -= 4; reasons.push(fit.note); }
    else if (fit.state === "tight") { score -= 1; reasons.push(fit.note); }
    // 설치 방식은 의미 있는 경우에만 알려 준다 (바닥에 놓는 가구에 "못이 필요 없어요"는 정보가 아니다)
    if (item.mount === "wall") reasons.push("벽에 못이 필요할 수 있어요 (원상복구 주의)");
    else if (item.mount === "hang") reasons.push("옷장 봉 등에 걸어 쓰는 제품이라 벽에 못이 필요 없어요");
    return { score: score, pref: pref, reasons: reasons, fit: fit };
  }

  // 이미 가진 카테고리와, 사용자 조건으로 제외되는 상품(벽에 못을 박기 어렵다면 벽걸이 상품)을 뺀 후보
  function candidatePool(items, opts) {
    var noWall = !!(opts.diagnosis.constraints && opts.diagnosis.constraints.noWall);
    return items.filter(function (i) { return opts.owned.indexOf(i.category) < 0 && !(noWall && i.mount === "wall"); });
  }

  // 사용자 조건과 방 크기를 어떻게 반영했는지 사람이 읽을 문장으로 설명한다
  function constraintNotes(items, opts) {
    var notes = [];
    var c = opts.diagnosis.constraints || {};
    if (c.noWall) {
      var wall = items.filter(function (i) { return opts.owned.indexOf(i.category) < 0 && i.mount === "wall"; });
      if (wall.length) {
        notes.push("벽에 못을 박기 어렵다고 하셔서 벽걸이 상품 " + wall.length + "개(" +
          unique(wall.map(function (i) { return i.category; })).join(", ") + ")는 후보에서 뺐어요.");
      }
    }
    if (c.compact) notes.push("공간이 좁다고 하셔서 같은 종류 안에서는 크기가 작은 상품에 점수를 더 줬어요.");
    if (c.frugal) notes.push("가격이 저렴한 편을 원하셔서 같은 종류 안에서는 저렴한 상품에 점수를 더 줬어요.");
    var floor = floorBudget(opts.room, opts.owned);
    if (floor) {
      notes.push("방 크기 " + (floor.room.w / 100) + "×" + (floor.room.d / 100) + "m(" + m2(floor.total) + "㎡) 기준으로, 통로를 빼고 가구를 둘 수 있는 바닥을 약 " +
        m2(floor.usable) + "㎡로 계산했어요." + (floor.ownedUsed ? " 이미 있는 가구가 차지하는 약 " + m2(floor.ownedUsed) + "㎡를 빼면 남은 여유는 약 " + m2(floor.remaining) + "㎡예요." : ""));
    }
    return notes;
  }

  function context(items, opts) {
    return { floor: floorBudget(opts.room, opts.owned), ranks: buildRanks(items) };
  }

  // 예산과 상관없이 카테고리(계열)별로 후보를 점수 순으로 정리한다. 사용자가 직접 고르는 화면용.
  // 반환: [{ category, score, options: [{ item, score, reasons, fit }] }]  (options[0]이 그 카테고리의 1순위)
  function suggest(items, opts) {
    var d = opts.diagnosis;
    var byId = {};
    items.forEach(function (i) { byId[i.id] = i; });
    var ctx = context(items, opts);
    var groups = {};
    candidatePool(items, opts).forEach(function (i) {
      var key = familyRoot(i, byId);
      (groups[key] = groups[key] || []).push(i);
    });
    return Object.keys(groups).map(function (key) {
      var options = groups[key].map(function (i) {
        var s = scoreItem(i, d, ctx);
        return { item: i, score: s.score, pref: s.pref, reasons: s.reasons, fit: s.fit };
      }).sort(function (a, b) { return b.score - a.score || a.item.price - b.item.price; });
      // 카테고리의 순서는 취향·고민·필요도·방 크기로만 정한다 (좁은 방·가성비 가점은 제외)
      return { category: options[0].item.category, score: options[0].score - options[0].pref, options: options };
    }).sort(function (a, b) {
      return b.score - a.score || a.options[0].item.priority - b.options[0].item.priority || a.options[0].item.price - b.options[0].item.price;
    });
  }

  // opts: { budget, owned: [카테고리], diagnosis, room }
  function recommend(items, opts) {
    var d = opts.diagnosis;
    var byId = {};
    items.forEach(function (i) { byId[i.id] = i; });
    var ctx = context(items, opts);
    var floor = ctx.floor;
    var floorLeft = floor ? floor.remaining : Infinity;

    var pool = candidatePool(items, opts);
    var scored = {};
    pool.forEach(function (i) { scored[i.id] = scoreItem(i, d, ctx); });

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
      var sa = scored[a.id].score - scored[a.id].pref, sb = scored[b.id].score - scored[b.id].pref;
      return sb - sa || a.priority - b.priority || a.price - b.price;
    });

    var picked = [], skipped = [], log = constraintNotes(items, opts), perCategory = {}, total = 0;
    var groups = d.needGroups || [], groupCount = groups.map(function () { return 0; }), deferred = [];
    function groupsOf(cat) {
      var out = [];
      groups.forEach(function (g, i) { if (g.categories.indexOf(cat) >= 0) out.push(i); });
      return out;
    }
    // 남은 바닥 여유에 들어가는지 (방 크기를 입력하지 않았다면 항상 true)
    function floorOk(it) { return !floor || (footprint(it) <= floorLeft && !tooLong(it, floor)); }
    function byScoreThenStyle(a, b) {
      var am = a.styles.indexOf(d.primary) >= 0 ? 1 : 0, bm = b.styles.indexOf(d.primary) >= 0 ? 1 : 0;
      return bm - am || b.price - a.price;
    }

    // target을 예산과 바닥 여유 안에서 고른다. 안 되면 같은 계열의 더 작거나 저렴한 상품으로 바꾸고, 그래도 안 되면 제외한다. 골랐으면 true
    function attempt(target0, extraReason) {
      var target = target0, replacedFrom = null;
      var family = families[familyRoot(target0, byId)];
      // 1) 방에 들어가는지
      if (!floorOk(target)) {
        var roomy = family.filter(floorOk).sort(function (a, b) { return scored[b.id].score - scored[a.id].score; });
        if (!roomy.length) {
          skipped.push({ item: target, reason: "방에 들어가기 어려워요 (남은 바닥 여유 " + m2(floorLeft) + "㎡)" });
          skipped[skipped.length - 1].kind = "floor";
          return false;
        }
        target = roomy[0]; replacedFrom = target0;
        log.push("'" + target0.name + "'은(는) 방에 들어가기 어려워서, 더 작은 '" + target.name + "'(으)로 바꿨어요");
      }
      // 2) 예산
      var remaining = opts.budget - total;
      var chosen = null;
      var cap = opts.budget * MAX_SHARE;
      var tooBig = target.price > cap && target.price <= remaining;  // 살 수는 있지만 예산을 너무 많이 차지하는 경우
      var lighter = tooBig ? family.filter(function (i) { return i.price < target.price && i.price <= cap && floorOk(i); }).sort(byScoreThenStyle) : [];
      if (lighter.length) {
        chosen = lighter[0];
        log.push("'" + target.name + "'은(는) 예산의 " + Math.round(target.price / opts.budget * 100) + "%라 다른 항목을 사기 어려워서, 더 저렴한 '" + chosen.name + "'(으)로 바꿨어요 (" + (target.price - chosen.price).toLocaleString("ko-KR") + "원 절약)");
        replacedFrom = replacedFrom || target;
      } else if (target.price <= remaining) {
        chosen = target;
      } else {
        var cheaper = family.filter(function (i) { return i.price < target.price && i.price <= remaining && floorOk(i); }).sort(byScoreThenStyle);
        if (!cheaper.length) {
          skipped.push({ item: target, reason: "남은 예산 " + remaining.toLocaleString("ko-KR") + "원으로는 살 수 없어요 (" + target.price.toLocaleString("ko-KR") + "원 필요)", kind: "budget" });
          return false;
        }
        chosen = cheaper[0];
        log.push("예산이 모자라 '" + target.name + "' 대신 더 저렴한 '" + chosen.name + "'(으)로 바꿨어요 (" + (target.price - chosen.price).toLocaleString("ko-KR") + "원 절약)");
        replacedFrom = replacedFrom || target;
      }
      groupsOf(chosen.category).forEach(function (i) { groupCount[i]++; });
      perCategory[chosen.category] = (perCategory[chosen.category] || 0) + 1;
      total += chosen.price;
      floorLeft -= footprint(chosen);
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
        (left.length ? " / 못 고름: " + nameList(left) : ""));
    }
    var budgetSkipped = skipped.filter(function (s) { return s.kind === "budget"; });
    var floorSkipped = skipped.filter(function (s) { return s.kind === "floor"; });
    if (budgetSkipped.length) {
      log.push("예산이 부족해 제외한 항목 " + budgetSkipped.length + "개: " + nameList(budgetSkipped.map(function (s) { return s.item.name; })));
    }
    if (floorSkipped.length) {
      log.push("방에 들어가기 어려워 제외한 항목 " + floorSkipped.length + "개: " + nameList(floorSkipped.map(function (s) { return s.item.name; })));
    }

    var minPrice = pool.length ? Math.min.apply(null, pool.map(function (i) { return i.price; })) : 0;
    return {
      picked: picked,
      skipped: skipped,
      log: log,
      total: total,
      budget: opts.budget,
      leftover: opts.budget - total,
      floor: floor ? { usable: floor.usable, ownedUsed: floor.ownedUsed, chosenUsed: floor.remaining - floorLeft, remaining: floorLeft } : null,
      tooLow: picked.length === 0 && pool.length > 0,
      nothingToBuy: pool.length === 0,
      minPrice: minPrice
    };
  }

  return {
    STYLES: STYLES, FLOOR_CATS: FLOOR_CATS,
    styleOptionsFromMoods: styleOptionsFromMoods,
    interpretText: interpretText, optionsFromText: optionsFromText,
    diagnose: diagnose, footprint: footprint, floorBudget: floorBudget, fitOf: fitOf,
    suggest: suggest, recommend: recommend, constraintNotes: constraintNotes
  };
})();
