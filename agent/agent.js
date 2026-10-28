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

  // ---- 직접 쓴 글 해석: 규칙(키워드) -> 예시 문장 유사도 -> 애매하면 되묻기. LLM은 쓰지 않는다.
  // kind: need(추천이 필요한 카테고리) / style(취향) / constraint(조건) / noProduct(우리 상품 데이터에 없는 종류)
  // re: 키워드 규칙(정확한 단어), examples: 말을 바꿔 쓴 문장을 잡기 위한 예시 문장(유사도 비교용)
  // generic: 일반 고민이라 같은 문장에 더 구체적인 말(예: 책장)이 있으면 양보한다. overrides: 이 의도가 잡히면 같은 문장에서 무시할 의도
  var NEED_STORAGE = ["선반", "수납장", "수납 박스", "바구니"];
  var NEED_SEAT = ["소파", "의자", "스툴", "벤치"];
  var NEED_EMPTY = ["꽃병", "화분", "벽장식", "시계", "거울", "쿠션", "소품"];
  var INTENTS = [
    { id: "light", kind: "need", meaning: "조명이 필요해요", needs: ["조명"],
      re: /어둡|어두|어둑|침침|캄캄|깜깜|흐려|흐릿|조명|불빛|밝게|밝았으면|환하게|램프|스탠드|무드등|전등|눈이 (아|피곤)|불이 약|불 ?켜|빛이/,
      examples: ["방이 어두워서 불편해요", "불을 켜도 침침해요", "책 읽을 조명이 필요해요", "밝은 전등이 있었으면 좋겠어요", "눈이 피곤하지 않은 불빛이면 좋겠어요", "은은한 무드등을 두고 싶어요", "빛이 부족해서 답답해요"] },
    { id: "storage", kind: "need", generic: true, meaning: "수납이 필요해요", needs: NEED_STORAGE,
      re: /수납|정리|어질러|어지러|너저분|지저분|어수선|짐이|짐을|물건이 많|물건 ?둘|서랍|옷이 많|옷 정리|옷장|둘 데|둘 곳|보관|넣어 ?둘|넣을 곳|잡동사니|잡다|쌓여|널려|물건을 넣/,
      examples: ["물건을 넣어둘 곳이 없어요", "방이 항상 어질러져 있어요", "옷을 둘 자리가 부족해요", "정리가 안 돼서 스트레스예요", "서랍이나 수납장이 있으면 좋겠어요", "잡동사니를 숨기고 싶어요", "짐이 많아서 방이 복잡해요"] },
    { id: "shelf", kind: "need", meaning: "책장·선반이 필요해요", needs: ["선반"],
      re: /책장|선반|책꽂이|책이 ?(너무 )?많|책을? ?꽂|꽂을|꽂아|서가|진열/,
      examples: ["책을 꽂아둘 책장이 필요해요", "물건을 올려둘 선반이 있었으면 해요", "책이 많아서 꽂을 곳이 필요해요", "진열할 수 있는 선반을 놓고 싶어요"] },
    { id: "underbed", kind: "need", meaning: "침대 밑 공간을 수납에 쓰고 싶어요", needs: ["수납 박스", "바구니"],
      re: /침대 ?(밑|아래|하부)/,
      examples: ["침대 밑에 이불을 넣어두고 싶어요", "침대 아래 빈 공간이 아까워요", "침대 하부를 창고처럼 쓰고 싶어요"] },
    { id: "vertical", kind: "need", meaning: "공간을 알뜰하게(벽·세로 공간) 쓰고 싶어요", needs: ["선반", "수납장"],
      re: /공간 ?(을 )?(잘 ?)?(활용|효율|알뜰)|벽에 ?(걸|달)|세로|높이를? ?활용|벽걸이|문 ?뒤|벽면|벽을 ?(활용|쓰|이용|사용)|벽 ?(이용|사용|활용)|위로 ?(쌓|올)|세워서|(걸|달) 수 있는|무타공|타공 ?없이/,
      examples: ["공간활용을 잘 하고 싶어요", "바닥 말고 벽을 활용하고 싶어요", "높이 쌓아서 공간을 아끼고 싶어요", "벽에 달 수 있는 수납이 좋아요", "문 뒤 빈 공간을 쓰고 싶어요"] },
    { id: "partition", kind: "need", meaning: "공간을 나누고 싶어요", needs: ["선반"], overrides: ["study", "sleep", "seat"],
      re: /공간 ?(을 )?(분리|구분|나누)|(구분|분리|나누).{0,6}(공간|영역)|파티션|칸막이/,
      examples: ["잠자는 곳과 공부하는 곳을 나누고 싶어요", "방 한가운데를 구분해 주는 가구가 필요해요", "원룸을 두 공간으로 분리하고 싶어요"] },
    { id: "shoes", kind: "need", meaning: "신발·현관 정리가 필요해요", needs: ["신발 선반", "벤치"],
      re: /신발|현관|구두|운동화/,
      examples: ["들어오자마자 신발이 널려 있어요", "신발을 정리할 곳이 필요해요", "앉아서 신발 벗을 자리가 있으면 좋겠어요"] },
    { id: "study", kind: "need", meaning: "공부·작업 공간이 필요해요", needs: ["책상", "의자", "조명"],
      re: /공부|책상(?! ?(위|앞|조명|스탠드))|작업(할|대| ?환경| ?자리|실)|노트북|재택|과제|시험|레포트|리포트|컴퓨터|데스크|업무|독서/,
      examples: ["집에서 공부할 자리가 필요해요", "노트북을 놓고 과제할 공간이 없어요", "재택근무 환경을 만들고 싶어요", "시험 준비할 자리가 있었으면 좋겠어요", "일할 수 있는 자리를 만들고 싶어요"] },
    { id: "seat", kind: "need", meaning: "앉을 곳이 필요해요", needs: NEED_SEAT,
      re: /앉|소파|의자|손님|친구가|친구 ?오|놀러|방문|휴식|쉴 곳|쉬는|걸터|기대/,
      examples: ["사람이 오면 앉을 데가 없어요", "편하게 쉴 수 있는 자리가 필요해요", "누워서 쉬고 싶어요", "영화 볼 때 편하게 앉고 싶어요"] },
    { id: "sleep", kind: "need", meaning: "잠자리를 보강하고 싶어요", needs: ["침대 프레임", "침구"],
      re: /침대(?! ?(밑|아래|하부|옆))|침구|이불|잠자|수면|숙면|베개|잠이|푹신(?! ?한? ?쿠션)/,
      examples: ["잠을 푹 자고 싶어요", "자려고 누우면 불편해요", "포근하게 잘 수 있는 잠자리가 필요해요", "바닥에서 자서 허리가 아파요"] },
    { id: "floor", kind: "need", meaning: "바닥을 보강하고 싶어요", needs: ["러그"],
      re: /바닥(이|은|에서)? ?(차|춥|시리|시려|휑|딱딱|밋밋)|러그|카펫|발이 ?시|발바닥|맨발|얼어|층간|소음|울려|맨바닥|외풍/,
      examples: ["발이 시려서 걸어 다니기 싫어요", "아래층에 소리가 들릴까 걱정돼요", "바닥이 휑하고 차가워요"] },
    { id: "empty", kind: "need", meaning: "방을 채우는 소품이 필요해요", needs: NEED_EMPTY,
      re: /허전|휑|삭막|밋밋|텅 ?빈|비어 ?보|인테리어 ?소품/,
      examples: ["방이 비어 보여서 쓸쓸해요", "벽이 너무 밋밋해요", "방에 포인트가 없어요", "썰렁해서 사람 사는 느낌이 안 나요"] },
    { id: "plant", kind: "need", meaning: "식물·화분을 두고 싶어요", needs: ["화분", "꽃병"],
      re: /식물|화분|초록|플랜테리어|꽃병|꽃을/,
      examples: ["방에 초록색이 있으면 좋겠어요", "작은 화분을 키워보고 싶어요", "꽃을 꽂아둘 곳이 필요해요"] },
    { id: "mirror", kind: "need", meaning: "거울이 필요해요", needs: ["거울"],
      re: /거울|전신|얼굴|화장|메이크업|옷차림|옷매무새|머리 ?손질|외출 ?(전|준비)/,
      examples: ["나가기 전에 옷차림을 확인하고 싶어요", "머리 손질할 때 볼 것이 필요해요"] },
    { id: "clock", kind: "need", meaning: "시계가 필요해요", needs: ["시계"],
      re: /시계|시간 ?(을 )?(자꾸 |자주 )?(확인|봐|보)|알람|지각|늦잠|몇 ?시/,
      examples: ["지금 몇 시인지 보고 싶어요", "아침에 늦지 않게 시간을 확인하고 싶어요"] },
    { id: "table", kind: "need", meaning: "테이블이 필요해요", needs: ["테이블"],
      re: /테이블|식탁|밥 ?(도 )?먹|커피|협탁|탁자|탁상|작은 ?상|상이|간식|화장대|충전기|침대 ?옆|올려 ?둘|사이드/,
      examples: ["침대 옆에 물건을 올려둘 곳이 필요해요", "차 한 잔 놓을 작은 자리가 있었으면 해요", "밥 먹을 때 쓸 상이 필요해요"] },
    { id: "cushion", kind: "need", meaning: "쿠션이 필요해요", needs: ["쿠션"],
      re: /쿠션/,
      examples: ["등에 받칠 쿠션이 있었으면 해요", "소파에 놓을 쿠션이 필요해요"] },
    { id: "warm", kind: "style", meaning: "따뜻한 분위기를 원해요", styles: { "따뜻한": 2 },
      re: /따뜻|따스|온기|감성|코지|포근|아늑|카페/,
      examples: ["집에 오면 마음이 편안해지는 분위기였으면 해요", "은은하고 따스한 느낌이 좋아요", "카페 같은 감성이 좋아요"] },
    { id: "wood", kind: "style", meaning: "나무 질감을 원해요", styles: { "우드": 2 },
      re: /우드|원목|나무|내추럴|자연/,
      examples: ["자연스러운 느낌이 좋아요", "원목 가구로 채우고 싶어요"] },
    { id: "minimal", kind: "style", meaning: "깔끔한 분위기를 원해요", styles: { "미니멀": 2 },
      re: /깔끔|심플|미니멀|화이트|정돈|단정|단순|하얀|말끔|산뜻|물건이 ?적|적어 ?보이|여백/,
      examples: ["물건이 적고 단정한 방이면 좋겠어요", "밝고 단순한 인테리어를 원해요", "군더더기 없이 정리된 느낌이 좋아요"] },
    { id: "modern", kind: "style", meaning: "세련된 분위기를 원해요", styles: { "모던": 2 },
      re: /모던|세련|도시|블랙|모노|시크|검정|고급|차분|호텔|럭셔리|무채색/,
      examples: ["고급스럽고 도시적인 느낌이요", "어두운 톤으로 차분하게 하고 싶어요"] },
    { id: "nordic", kind: "style", meaning: "북유럽 스타일을 원해요", styles: { "우드": 3, "미니멀": 2, "따뜻한": 1 }, re: /북유럽|스칸디/, examples: ["스칸디나비아풍으로 꾸미고 싶어요"] },
    { id: "vintage", kind: "style", meaning: "빈티지·레트로 스타일을 원해요", styles: { "따뜻한": 3, "우드": 1 }, re: /빈티지|레트로|앤티크/, examples: ["옛날 감성의 방을 만들고 싶어요"] },
    { id: "lovely", kind: "style", meaning: "러블리·로맨틱 스타일을 원해요", styles: { "따뜻한": 3, "미니멀": 1 }, re: /러블리|로맨틱|핑크|파스텔/, examples: ["사랑스럽고 아기자기한 방이 좋아요"] },
    { id: "industrial", kind: "style", meaning: "인더스트리얼 스타일을 원해요", styles: { "모던": 3, "우드": 1 }, re: /인더스트리얼|공장|벽돌|철제|콘크리트/, examples: ["거칠고 투박한 느낌의 방을 원해요"] },
    { id: "dark", kind: "style", meaning: "어둡고 차분한 분위기를 원해요", styles: { "모던": 3, "따뜻한": 1 }, overrides: ["light"],
      re: /(어둡|어두운|다크|칙칙)\s?(한|게)?\s?(분위기|느낌|톤|색감|인테리어|스타일|컨셉|콘셉트)|다크 ?(모드|톤)/, examples: ["차분하고 어두운 톤으로 꾸미고 싶어요"] },
    { id: "french", kind: "style", meaning: "프렌치·프로방스 스타일을 원해요", styles: { "따뜻한": 3, "미니멀": 1 }, re: /프렌치|프로방스/, examples: ["프랑스 가정집 같은 분위기가 좋아요"] },
    { id: "nail", kind: "constraint", meaning: "벽에 못을 박기 어려워요", constraints: { noWall: true },
      re: /못.*(박|안|어렵|안 ?돼|싫|뚫|쓰기|치)|원상복구|복구|월세|보증금|깎일|물어 ?(줘|내)|(구멍|타공).*(안|못|싫|어렵|절대|뚫)|무타공|구멍 ?안|탈부착|퇴실|집주인|임대|흠집|흔적|스크래치|도배|벽지 ?(상|손상|훼손)/,
      examples: ["집주인이 벽을 건드리지 말래요", "나갈 때 흔적이 남으면 안 돼요", "벽에 손대지 않고 꾸미고 싶어요"] },
    { id: "compact", kind: "constraint", meaning: "공간이 좁아서 작은 가구가 좋아요", constraints: { compact: true },
      re: /좁|비좁|작은 ?방|방이 ?작|한 ?칸|협소|공간이 ?(부족|없)|공간 ?부족|답답|여유가 ?없|꽉 ?차|빡빡|낮은 ?가구|키 ?작은 ?가구|작은 ?가구|큰 ?가구는 ?부담|소형|컴팩트|원룸이 ?작|가구 ?몇 ?개|넓어 ?보이|넓게 ?쓰/,
      examples: ["방이 작아서 가구를 많이 못 놓아요", "움직일 공간이 없어요", "가구를 놓으면 방이 꽉 차요", "큰 가구는 들어가지 않아요"] },
    { id: "frugal", kind: "constraint", meaning: "가격이 저렴한 편을 원해요", constraints: { frugal: true },
      re: /저렴|가성비|싸게|싸고|싼|알뜰|돈이 ?(없|별로)|용돈|빠듯|학생이라|부담스러|예산이 ?적|절약|아끼|가격 ?부담|부담 ?(없|이 ?적)|중고|렌탈|저가/,
      examples: ["가진 돈이 많지 않아요", "너무 비싸지 않았으면 좋겠어요", "학생이라 예산이 빠듯해요"] },
    { id: "np_curtain", kind: "noProduct", meaning: "커튼", re: /커튼|블라인드|암막|창문 ?(을 )?(가리|가릴|가림)|가림막|햇빛 ?(을 )?(가리|차단)/, examples: ["창문을 가릴 것이 필요해요"] },
    { id: "np_hook", kind: "noProduct", meaning: "압축봉·후크·행거", overrides: ["storage"], re: /압축봉|후크|고리|행거|옷 ?걸이|걸이대|걸어 ?(둘|놓)|걸 ?곳/, examples: ["옷을 걸어둘 곳이 필요해요"] },
    { id: "np_mattress", kind: "noProduct", meaning: "매트리스·토퍼", overrides: ["sleep"], re: /매트리스|토퍼|침대 ?패드|이부자리|깔 ?요|요를|요가 ?필요|침낭|바닥에 ?깔/, examples: ["바닥에 깔고 잘 푹신한 것이 필요해요"] },
    { id: "np_beanbag", kind: "noProduct", meaning: "빈백", overrides: ["seat"], re: /빈백/, examples: ["푹 꺼지는 쿠션 의자를 갖고 싶어요"] },
    { id: "np_appliance", kind: "noProduct", meaning: "가전제품", re: /냉장고|세탁기|에어컨|전자레인지|선풍기|히터|가전|티비|텔레비전|청소기|공기청정기/, examples: ["여름에 시원하게 지내고 싶어요"] }
  ];
  var INTENT_BY_ID = {};
  INTENTS.forEach(function (it) { INTENT_BY_ID[it.id] = it; });

  // 부정: 필요한 것으로 읽으면 안 되는 문장("어둡지 않아요", "수납은 충분해요"). 조건(못 박기 어려움 등)과 취향에는 적용하지 않는다.
  var STYLE_NEGATION = /싫|별로|말고|원하지 ?않|아니/;   // "어두운 분위기는 싫어요"처럼 취향을 거부하는 말
  var NEGATION = /(지|진) ?(않|못)|괜찮|충분|넉넉|필요 ?없|됐어|안 ?(어둡|어두|좁|부족)|아쉽지/;
  // 한 문장 안에서 뜻이 갈리는 연결 표현(…인데 / …지만 / …괜찮고)은 앞에서 끊는다
  var CLAUSE_BREAK = /(괜찮고|괜찮은데|괜찮지만|충분한데|충분하고|충분하지만|필요 ?없고|필요 ?없지만|필요 ?없는데|인데|한데|은데|는데|지만|그런데|면서|으며|이며)/g;

  // ---- 유사도: 글자 두 개씩(bigram) 쪼갠 집합의 겹침. 어미를 떼고 비교해 "해요"처럼 흔한 끝말 때문에 비슷해 보이는 것을 줄인다.
  var ENDINGS = /(이?에요|예요|해요|어요|아요|네요|습니다|세요|싶어요|좋겠어요|했으면|있었으면|있으면|으면 ?해요|면 ?좋겠어요)$/;
  var SIM_ACCEPT = 0.62;      // 이 이상이면 바로 반영
  var SIM_ASK = 0.40;         // 이 이상이면 "이런 뜻인가요?"로 되묻는다
  function stem(text) {
    var t = String(text).replace(/[\s.,!?;·~…'"“”]+/g, "");
    var prev;
    do { prev = t; t = t.replace(ENDINGS, ""); } while (t !== prev && t.length > 2);
    return t;
  }
  function grams(text) {
    var t = stem(text), g = {}, n = 0;
    for (var i = 0; i + 1 < t.length; i++) { var k = t.substr(i, 2); if (!g[k]) { g[k] = 1; n++; } }
    return { set: g, n: n };
  }
  function similarity(a, b) {
    if (!a.n || !b.n) return 0;
    var common = 0;
    Object.keys(a.set).forEach(function (k) { if (b.set[k]) common++; });
    var dice = 2 * common / (a.n + b.n), overlap = common / Math.min(a.n, b.n);
    return 0.5 * dice + 0.5 * overlap;
  }
  INTENTS.forEach(function (it) { it.exampleGrams = it.examples.map(grams); });

  function bestSimilarities(clause) {
    var g = grams(clause), out = [];
    INTENTS.forEach(function (it) {
      var best = 0;
      it.exampleGrams.forEach(function (eg) { var s = similarity(g, eg); if (s > best) best = s; });
      out.push({ id: it.id, meaning: it.meaning, score: Math.round(best * 100) / 100 });
    });
    return out.sort(function (a, b) { return b.score - a.score; });
  }

  function matchOf(it, phrase, via, score) {
    return { id: it.id, kind: it.kind, phrase: phrase, meaning: it.meaning, needs: it.needs || [], styles: it.styles || {}, constraints: it.constraints || {}, via: via, score: score };
  }

  // 반환: { matches: [{ id, kind, phrase, meaning, needs, styles, constraints, via: keyword|similar|confirmed, score }],
  //         noProduct: [{ id, phrase, meaning }], negated: [{ phrase, meaning }], uncertain: [{ phrase, candidates: [{ id, meaning, score }] }], unknown: [문장] }
  // opts: { similarity: false면 키워드 규칙만, choices: { 문장: 의도 id | "none" } 되묻기에 사용자가 답한 것 }
  function interpretText(text, opts) {
    opts = opts || {};
    var useSim = opts.similarity !== false, choices = opts.choices || {};
    var askAt = opts.askThreshold !== undefined ? opts.askThreshold : SIM_ASK;   // (평가용) 되묻기 문턱을 바꿔 볼 수 있다
    var out = { matches: [], noProduct: [], negated: [], uncertain: [], unknown: [] };
    var clauses = String(text || "").replace(CLAUSE_BREAK, "$1,").split(/[,.\n!?;·]+|\s+(?:그리고|그래서|근데|하지만|또는)\s+/)
      .map(function (c) { return c.trim(); }).filter(function (c) { return c.length >= 2; });
    var seen = {};
    clauses.forEach(function (clause) {
      var squeezed = clause.replace(/\s+/g, "");   // 띄어쓰기 없이 쓴 문장("방이너무어두워요")도 잡는다
      var hits = INTENTS.filter(function (it) { return it.re.test(clause) || it.re.test(squeezed); });
      var hitIds = hits.map(function (it) { return it.id; });
      // 더 구체적인 말이 있으면 일반 고민은 양보하고, 지정한 의도는 같은 문장에서 무시한다
      var suppressed = {};
      hits.forEach(function (it) { (it.overrides || []).forEach(function (o) { suppressed[o] = true; }); });
      var specificStorage = ["shelf", "underbed", "vertical", "partition", "shoes"].some(function (id) { return hitIds.indexOf(id) >= 0; });
      if (specificStorage) suppressed.storage = true;
      hits = hits.filter(function (it) { return !suppressed[it.id]; });
      var negated = NEGATION.test(clause);
      var accepted = 0;
      hits.forEach(function (it) {
        var rejected = (negated && (it.kind === "need" || it.kind === "noProduct")) || (it.kind === "style" && STYLE_NEGATION.test(clause));
        if (rejected) { out.negated.push({ phrase: clause, meaning: it.meaning }); return; }
        if (seen[it.id]) { accepted++; return; }
        seen[it.id] = true; accepted++;
        if (it.kind === "noProduct") out.noProduct.push({ id: it.id, phrase: clause, meaning: it.meaning });
        else out.matches.push(matchOf(it, clause, "keyword", 1));
      });
      if (hits.length || negated) { if (!accepted && !negated) out.unknown.push(clause); return; }
      // 키워드가 하나도 없는 문장: 사용자가 이미 답했으면 그대로, 아니면 예시 문장과의 유사도로 판단
      var choice = choices[clause];
      if (choice === "none") { out.unknown.push(clause); return; }
      if (choice && INTENT_BY_ID[choice]) {
        var ci = INTENT_BY_ID[choice];
        if (ci.kind === "noProduct") out.noProduct.push({ id: ci.id, phrase: clause, meaning: ci.meaning });
        else if (!seen[ci.id]) { seen[ci.id] = true; out.matches.push(matchOf(ci, clause, "confirmed", 1)); }
        return;
      }
      if (!useSim) { out.unknown.push(clause); return; }
      var ranked = bestSimilarities(clause), top = ranked[0];
      if (top.score >= SIM_ACCEPT) {
        var ti = INTENT_BY_ID[top.id];
        if (ti.kind === "noProduct") out.noProduct.push({ id: ti.id, phrase: clause, meaning: ti.meaning });
        else if (!seen[ti.id]) { seen[ti.id] = true; out.matches.push(matchOf(ti, clause, "similar", top.score)); }
      } else if (top.score >= askAt) {
        out.uncertain.push({ phrase: clause, candidates: ranked.filter(function (r) { return r.score >= askAt; }).slice(0, 3) });
      } else {
        out.unknown.push(clause);
      }
    });
    return out;
  }

  // ---- LLM이 고른 의도 ID를 같은 모양의 해석 결과로 바꾼다 (모델 호출은 agent 밖: llm.js / tools/dev_server.py)
  // 카탈로그: 모델에게 보여 줄 "고를 수 있는 의도" 목록
  function intentCatalog() {
    return INTENTS.map(function (it) { return { id: it.id, kind: it.kind, meaning: it.meaning }; });
  }

  // 아무것도 못 알아들은 문장을 되물을 때 쓰는 갈래. 1단계에서 갈래를 고르고 2단계에서 그 안의 항목을 고른다(상품이 없는 종류는 제외).
  var ASK_GROUPS = [
    { id: "space", label: "수납·공간", ids: ["storage", "shelf", "underbed", "vertical", "shoes", "partition"] },
    { id: "living", label: "조명·생활 가구", ids: ["light", "study", "seat", "sleep", "floor", "table"] },
    { id: "decor", label: "소품·장식", ids: ["empty", "plant", "mirror", "clock", "cushion"] },
    { id: "style", label: "분위기·스타일", kind: "style" },
    { id: "constraint", label: "조건(못·좁음·가격)", kind: "constraint" }
  ];
  function askGroups() {
    return ASK_GROUPS.map(function (g) {
      var list = INTENTS.filter(function (it) { return g.kind ? it.kind === g.kind : g.ids.indexOf(it.id) >= 0; });
      return { id: g.id, label: g.label, intents: list.map(function (it) { return { id: it.id, meaning: it.meaning }; }) };
    });
  }

  // clauses: [{ phrase, intents: [의도 id], negated: bool }]. 목록에 없는 id는 버리고, 부정은 규칙 방식과 같게 need/noProduct에만 적용한다.
  // 모델이 아무것도 고르지 못한 절은 버리지 않고 규칙 방식(키워드·유사도·되묻기)으로 한 번 더 읽는다.
  function interpretFromLLM(clauses, opts) {
    var out = { matches: [], noProduct: [], negated: [], uncertain: [], unknown: [] }, seen = {}, rest = [];
    (Array.isArray(clauses) ? clauses : []).forEach(function (c) {
      if (!c || typeof c.phrase !== "string") return;
      var phrase = c.phrase.trim().slice(0, 120);
      if (!phrase) return;
      var ids = (Array.isArray(c.intents) ? c.intents : []).filter(function (id) { return typeof id === "string" && INTENT_BY_ID[id]; });
      if (!ids.length) { rest.push(phrase); return; }
      ids.forEach(function (id) {
        var it = INTENT_BY_ID[id];
        if (c.negated === true && (it.kind === "need" || it.kind === "noProduct")) { out.negated.push({ phrase: phrase, meaning: it.meaning }); return; }
        if (seen[id]) return;
        seen[id] = true;
        if (it.kind === "noProduct") out.noProduct.push({ id: id, phrase: phrase, meaning: it.meaning });
        else out.matches.push(matchOf(it, phrase, "llm", 1));
      });
    });
    rest.forEach(function (phrase) {
      var r = interpretText(phrase, opts);
      r.matches.forEach(function (m) { if (!seen[m.id]) { seen[m.id] = true; out.matches.push(m); } });
      r.noProduct.forEach(function (n) { if (!seen[n.id]) { seen[n.id] = true; out.noProduct.push(n); } });
      out.negated = out.negated.concat(r.negated); out.uncertain = out.uncertain.concat(r.uncertain); out.unknown = out.unknown.concat(r.unknown);
    });
    return out;
  }

  // 해석 결과 -> 진단에 넣을 선택지 (우리 상품이 없는 종류는 추천에 쓰지 않는다)
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
    intentCatalog: intentCatalog, askGroups: askGroups, interpretFromLLM: interpretFromLLM,
    diagnose: diagnose, footprint: footprint, floorBudget: floorBudget, fitOf: fitOf,
    suggest: suggest, recommend: recommend, constraintNotes: constraintNotes
  };
})();
