// 개선 전 기준선: 2026-10-27 커밋(1e272e5)의 키워드 규칙을 그대로 복사해 얼려 둔 것. 평가에서 비교용으로만 쓴다(수정하지 않는다).
var BaselineText = (function () {
  "use strict";
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

  return { interpret: interpretText };
})();
