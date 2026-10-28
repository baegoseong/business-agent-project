// 화면 흐름: 1 방 정보 -> 2 취향(방 분위기 고르기, 아쉬운 점, 직접 쓰기) -> 3 추천 상품 고르기(예산·방 크기 맞추기) -> 4 사진 위 배치
(function () {
  "use strict";

  var MIN_PICKS = 1, MAX_PICKS = 3;

  // 객관식 질문: 취향은 사진으로 고르므로 여기서는 아쉬운 점과 조건만 묻는다
  var QUESTIONS = [
    { id: "need", title: "지금 방에서 아쉬운 점은? (여러 개 선택 가능)", multi: true, options: [
      { label: "물건 둘 곳이 부족해요", needs: ["선반", "수납장", "수납 박스", "바구니", "신발 선반"] },
      { label: "방이 어두워요", needs: ["조명"] },
      { label: "휑하고 허전해요", needs: ["꽃병", "화분", "소품", "벽장식", "시계", "거울", "쿠션"] },
      { label: "바닥이 차갑고 밋밋해요", needs: ["러그"] },
      { label: "앉을 곳이 아쉬워요", needs: ["의자", "스툴", "벤치", "소파"] },
      { label: "잠자리가 아쉬워요", needs: ["침구", "침대 프레임"] },
      { label: "작업할 책상이 아쉬워요", needs: ["책상", "테이블"] } ] },
    { id: "limit", title: "지켜야 할 조건이 있나요? (선택)", multi: true, options: [
      { label: "벽에 못을 박기 어려워요 (벽걸이 상품은 빼 주세요)", constraints: { noWall: true } } ] }
  ];

  var state = {
    items: [], photoURL: null,
    moods: [], picks: [],          // 방 분위기 사진 8개와 사용자가 고른 분위기 id
    interp: { matches: [], noProduct: [], negated: [], uncertain: [], unknown: [] },
    choices: {}, askGroup: {}, unknownAsk: [], asking: [],       // 되묻기에 사용자가 답한 것(문장 -> 의도)과 지금 되묻고 있는 문장들
    diagnosis: null, owned: [], room: null, budget: 0,
    groups: [],      // Agent.suggest 결과: 카테고리별 후보 목록
    current: [],     // 카테고리마다 지금 보여 주는 후보의 위치
    picked: [],      // 카테고리마다 담았는지
    open: [],        // 카테고리마다 '다른 상품 보기'가 펼쳐졌는지
    selected: [],    // 담은 상품 (4단계로 넘어갈 목록)
    autoLog: []
  };
  var $ = function (sel) { return document.querySelector(sel); };
  var won = function (n) { return n.toLocaleString("ko-KR") + "원"; };
  var m2 = function (cm2) { return (Math.round(cm2 / 100) / 100).toLocaleString("ko-KR"); };   // cm² -> ㎡
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };

  function showStep(n) {
    for (var i = 1; i <= 4; i++) $("#step" + i).hidden = (i !== n);
    var lis = document.querySelectorAll("#steps li");
    for (var j = 0; j < lis.length; j++) { lis[j].classList.toggle("on", j === n - 1); lis[j].classList.toggle("done", j < n - 1); }
    if (n === 4) Overlay.resize();
    window.scrollTo(0, 0);
  }

  // ---- 1. 방 정보
  function budgetValue(sel) { return Math.max(0, parseInt($(sel).value, 10) || 0); }

  // 방 크기(cm). 가로·세로를 모두 적절히 입력했을 때만 쓴다
  function roomValue() {
    var w = parseInt($("#roomW").value, 10), d = parseInt($("#roomD").value, 10);
    return w >= 100 && d >= 100 ? { w: w, d: d } : null;
  }

  function bindStep1() {
    $("#budgetChips").addEventListener("click", function (e) {
      if (e.target.dataset.v) $("#budget").value = e.target.dataset.v;
    });
    $("#roomChips").addEventListener("click", function (e) {
      if (e.target.dataset.w) { $("#roomW").value = e.target.dataset.w; $("#roomD").value = e.target.dataset.d; }
    });
    $("#photoInput").addEventListener("change", function (e) {
      var file = e.target.files[0];
      if (!file) return;
      if (state.photoURL) URL.revokeObjectURL(state.photoURL);
      state.photoURL = URL.createObjectURL(file);
      $("#photoPreview").src = state.photoURL; $("#photoPreview").hidden = false;
      $("#photoText").hidden = true;
    });
    $("#to2").addEventListener("click", function () { showStep(2); });
  }

  // ---- 2. 취향: 방 분위기 고르기, 객관식, 직접 쓰기
  // 방 분위기 사진: data/moods.json (오늘의집 스타일 이름 + Pexels 사진). 고른 분위기의 스타일 가중치로 취향을 진단한다
  function renderMood() {
    $("#moodGrid").innerHTML = state.moods.map(function (m) {
      return '<button type="button" class="mood" data-id="' + esc(m.id) + '" aria-pressed="false" aria-label="' + esc(m.title + ": " + m.subtitle) + '">' +
        '<img class="mood-photo" src="' + esc(m.image) + '" alt="" loading="lazy">' +
        '<span class="mood-title">' + esc(m.title) + '</span><span class="mood-sub">' + esc(m.subtitle) + '</span><span class="tick" aria-hidden="true">✓</span></button>';
    }).join("");
    var who = state.moods.map(function (m) { return m.credit.photographer; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
    $("#moodCredits").textContent = "방 분위기 사진: Pexels (Pexels License) · " + who.join(", ") + ".";
    updateMoodCount();
  }

  function updateMoodCount() {
    var n = state.picks.length;
    $("#moodCount").textContent = n === 0 ? "마음에 드는 방 분위기를 " + MIN_PICKS + "~" + MAX_PICKS + "개 눌러 주세요."
      : n + "개 골랐어요. (최대 " + MAX_PICKS + "개)";
  }

  function bindMood() {
    $("#moodGrid").addEventListener("click", function (e) {
      var b = e.target.closest(".mood");
      if (!b) return;
      var id = b.dataset.id, k = state.picks.indexOf(id);
      if (k >= 0) state.picks.splice(k, 1);
      else if (state.picks.length < MAX_PICKS) state.picks.push(id);
      else { $("#moodCount").textContent = "최대 " + MAX_PICKS + "개까지 고를 수 있어요. 하나를 빼고 골라 주세요."; return; }
      var on = state.picks.indexOf(id) >= 0;
      b.classList.toggle("on", on); b.setAttribute("aria-pressed", on ? "true" : "false");
      updateMoodCount();
    });
  }

  function renderQuestions() {
    $("#questions").innerHTML = QUESTIONS.map(function (q) {
      return '<fieldset class="q"><legend>' + esc(q.title) + "</legend>" + q.options.map(function (o, i) {
        return '<label class="opt"><input type="' + (q.multi ? "checkbox" : "radio") + '" name="' + q.id +
          '" value="' + i + '"> ' + esc(o.label) + "</label>";
      }).join("") + "</fieldset>";
    }).join("");
  }

  function selectedOptions() {
    var out = [];
    QUESTIONS.forEach(function (q) {
      var checked = document.querySelectorAll('input[name="' + q.id + '"]:checked');
      for (var i = 0; i < checked.length; i++) out.push(q.options[+checked[i].value]);
    });
    return out;
  }

  // 직접 쓴 글을 어떻게 이해했는지 바로 보여 준다. 애매한 문장은 "이런 뜻인가요?"라고 되묻고, 못 알아들은 문장과 우리 상품에 없는 종류는 숨기지 않고 알려 준다.
  function currentInterp() {
    var text = $("#freeText").value, llm = LLM.cached(text);
    return llm ? Agent.interpretFromLLM(llm, { choices: state.choices }) : Agent.interpretText(text, { choices: state.choices });
  }

  // 로컬 서버에 키가 있으면 글을 LLM으로도 읽는다. 호출 한도가 작아 입력을 멈춘 뒤 한 번만 부르고, 실패하면 규칙 방식 결과를 그대로 쓴다.
  var llmTimer = null;
  function askLLM(text) {
    return LLM.interpret(text, Agent.intentCatalog()).then(function (r) { if ($("#freeText").value === text) renderInterpretation(); return r; });
  }
  function llmStatusHtml() {
    var t = $("#freeText").value;
    if (!LLM.isAvailable() || !t.trim()) return "";
    if (LLM.cached(t)) return '<div class="interp-llm">AI(' + esc(LLM.model()) + ')가 읽고 이해한 결과예요.</div>';
    if (LLM.failed(t)) return '<div class="interp-llm">AI 해석에 실패해서 규칙 방식으로 이해했어요.</div>';
    return '<div class="interp-llm">AI가 글을 읽는 중이에요… (그동안은 규칙 방식 결과예요)</div>';
  }

  function renderInterpretation() {
    var r = state.interp = currentInterp(), html = llmStatusHtml();
    state.asking = r.uncertain.map(function (u) { return u.phrase; });
    if (r.matches.length) {
      html += '<div class="interp-title">이렇게 이해했어요</div><ul class="interp-list">' + r.matches.map(function (m) {
        var how = m.via === "confirmed" ? " · 직접 확인했어요" : m.via === "similar" ? " · 비슷한 표현으로 이해했어요" : m.via === "llm" ? " · AI가 이해했어요" : "";
        return "<li><b>" + esc(m.meaning) + '</b><span>← "' + esc(m.phrase) + '"' + how + "</span></li>";
      }).join("") + "</ul>";
    }
    r.uncertain.forEach(function (u, i) {
      html += '<div class="interp-ask"><div>“' + esc(u.phrase) + '” — 혹시 이런 뜻인가요?</div><div class="ask-buttons">' +
        u.candidates.map(function (c) { return '<button type="button" data-ask="' + i + '" data-intent="' + esc(c.id) + '">' + esc(c.meaning.replace(/^(.*)$/, "$1")) + "</button>"; }).join("") +
        '<button type="button" class="none" data-ask="' + i + '" data-intent="none">해당 없음</button></div></div>';
    });
    if (r.noProduct.length) {
      html += '<div class="interp-noproduct">아직 상품이 없어서 추천하지 못하는 요청: ' + r.noProduct.map(function (n) { return "<b>" + esc(n.meaning) + "</b>"; }).join(", ") +
        '<div class="hint">지금 상품 데이터(가구·소품 153개)에는 없는 종류예요.</div></div>';
    }
    if (r.negated.length) {
      html += '<div class="interp-negated">부정으로 이해해서 반영하지 않았어요: ' + r.negated.map(function (n) { return "“" + esc(n.phrase) + "”"; }).join(", ") + "</div>";
    }
    state.unknownAsk = r.unknown.filter(function (u) { return state.choices[u] !== "none"; });
    state.unknownAsk.forEach(function (u, i) {
      var gid = state.askGroup[u], groups = Agent.askGroups(), g = groups.filter(function (x) { return x.id === gid; })[0];
      html += '<div class="interp-ask interp-unk"><div>“' + esc(u) + '” — ' + (g ? "이 중에 가까운 게 있나요?" : "못 알아들었어요. 어떤 쪽에 가까운가요?") + '</div><div class="ask-buttons">' +
        (g ? g.intents.map(function (it) { return '<button type="button" data-unk="' + i + '" data-intent="' + esc(it.id) + '">' + esc(it.meaning) + "</button>"; }).join("") +
              '<button type="button" class="none" data-unk="' + i + '" data-group="">뒤로</button>'
           : groups.map(function (x) { return '<button type="button" data-unk="' + i + '" data-group="' + esc(x.id) + '">' + esc(x.label) + "</button>"; }).join("")) +
        '<button type="button" class="none" data-unk="' + i + '" data-intent="none">해당 없음</button></div></div>';
    });
    if (r.unknown.length && !state.unknownAsk.length) {
      html += '<div class="interp-unknown">반영하지 않은 표현: ' + r.unknown.map(function (u) { return "“" + esc(u) + "”"; }).join(", ") + "</div>";
    }
    $("#interpret").innerHTML = html;
  }

  function bindInterpretation() {
    $("#freeText").addEventListener("input", function () {
      state.choices = {}; state.askGroup = {}; renderInterpretation();
      clearTimeout(llmTimer);
      var t = $("#freeText").value;
      if (LLM.isAvailable() && t.trim().length >= 2 && !LLM.settled(t)) llmTimer = setTimeout(function () { askLLM(t); }, 1200);
    });
    $("#interpret").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.unk !== undefined) {   // 아무것도 못 알아들은 문장: 갈래 -> 항목 두 단계
        var phrase = state.unknownAsk[+b.dataset.unk];
        if (b.dataset.intent) state.choices[phrase] = b.dataset.intent; else state.askGroup[phrase] = b.dataset.group;
        renderInterpretation();
        return;
      }
      if (b.dataset.ask === undefined) return;
      state.choices[state.asking[+b.dataset.ask]] = b.dataset.intent;
      renderInterpretation();
    });
  }

  // ---- 3. 추천 상품 고르기
  // AI 해석이 켜져 있으면 결과가 올 때까지 잠깐 기다렸다가 진행한다(실패해도 진행)
  function runAgent() {
    var t = $("#freeText").value;
    if (!LLM.isAvailable() || !t.trim() || LLM.settled(t) || state.picks.length < MIN_PICKS) return runAgentNow();
    var btn = $("#to3"), label = btn.textContent;
    btn.disabled = true; btn.textContent = "AI가 글을 읽는 중…";
    clearTimeout(llmTimer);
    askLLM(t).then(function () { btn.disabled = false; btn.textContent = label; runAgentNow(); });
  }

  function runAgentNow() {
    if (state.picks.length < MIN_PICKS) {
      $("#q-error").textContent = "마음에 드는 방 분위기를 " + MIN_PICKS + "개 이상 골라 주세요."; $("#q-error").hidden = false;
      $("#moodGrid").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    $("#q-error").hidden = true;
    // 체크 항목 하나가 여러 카테고리를 뜻할 수 있어(예: 수납 가구 = 선반, 수납장) 쉼표로 이어 둔 값을 펼친다
    state.owned = [];
    Array.prototype.forEach.call(document.querySelectorAll("#ownedChecks input:checked"), function (c) { state.owned = state.owned.concat(c.value.split(",")); });
    renderInterpretation();   // 현재 글과 되묻기 답으로 다시 해석
    var chosen = state.moods.filter(function (m) { return state.picks.indexOf(m.id) >= 0; });
    var options = Agent.styleOptionsFromMoods(chosen).concat(selectedOptions(), Agent.optionsFromText(state.interp));
    state.room = roomValue();
    state.diagnosis = Agent.diagnose(options);
    state.groups = Agent.suggest(state.items, { owned: state.owned, diagnosis: state.diagnosis, room: state.room });
    state.current = state.groups.map(function () { return 0; });
    state.picked = state.groups.map(function () { return false; });
    state.open = state.groups.map(function () { return false; });
    state.autoLog = [];
    state.budget = budgetValue("#budget");
    $("#budget3").value = state.budget;
    renderStep3();
    showStep(3);
  }

  function currentOption(g) { return state.groups[g].options[state.current[g]]; }

  function cardHtml(g) {
    var grp = state.groups[g], opt = currentOption(g), it = opt.item, on = state.picked[g];
    var others = grp.options.length - 1, fit = opt.fit || { state: "none" };
    var fitBadge = fit.state === "over" ? '<span class="badge warn">방에 들어가기 어려워요</span>'
      : fit.state === "tight" ? '<span class="badge caution">방에 비해 큰 편</span>' : "";
    var h = '<div class="card' + (on ? " on" : "") + '"><div class="item"><div class="thumb"><img src="' + esc(it.image) + '" alt=""></div><div class="body">' +
      '<div class="name">' + esc(it.name) + (state.current[g] === 0 ? '<span class="badge top">추천 1순위</span>' : "") + fitBadge + "</div>" +
      (it.brand ? '<div class="brand">' + esc(it.brand) + "</div>" : "") +
      '<div class="price">약 ' + won(it.price) + " · " + esc(it.category) + "</div>" +
      (opt.reasons.length ? "<ul>" + opt.reasons.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>" : "") +
      '<div class="card-actions"><button type="button" class="pick' + (on ? " on" : "") + '" data-act="pick" data-g="' + g + '">' + (on ? "✓ 담음 (누르면 빼기)" : "담기") + "</button>" +
      (others ? '<button type="button" data-act="more" data-g="' + g + '">' + (state.open[g] ? "접기" : "같은 종류 다른 상품 " + others + "개 보기") + "</button>" : "") +
      "</div></div></div>";
    if (state.open[g]) {
      h += '<div class="alts">' + grp.options.map(function (o, k) {
        if (k === state.current[g]) return "";
        var warn = o.fit && o.fit.state === "over" ? " warn" : "";
        return '<button type="button" class="alt' + warn + '" data-act="alt" data-g="' + g + '" data-o="' + k + '"><img src="' + esc(o.item.image) + '" alt="">' +
          "<span>" + esc(o.item.name) + "</span><b>약 " + won(o.item.price) + "</b>" + (warn ? "<em>방에 큼</em>" : "") + "</button>";
      }).join("") + "</div>";
    }
    return h + "</div>";
  }

  function renderStep3() {
    var d = state.diagnosis, r = state.interp;
    var notes = Agent.constraintNotes(state.items, { owned: state.owned, diagnosis: d, room: state.room });
    if (r.matches.length) notes.push("직접 적으신 내용에서 " + r.matches.length + "가지를 반영했어요: " + r.matches.map(function (m) { return m.meaning; }).join(", ") + ".");
    if (r.noProduct.length) notes.push("아직 상품이 없어서 추천하지 못하는 요청: " + r.noProduct.map(function (n) { return n.meaning; }).join(", ") + ".");
    var notUnderstood = r.unknown.concat(r.uncertain.map(function (u) { return u.phrase; }));
    if (notUnderstood.length) notes.push("반영하지 못한 표현: " + notUnderstood.map(function (u) { return "“" + u + "”"; }).join(", ") + " (글은 정해 둔 단어와 비슷한 표현만 이해해서 일부는 반영하지 못해요).");
    $("#diag").innerHTML = '<div class="summary"><b>진단 결과: ' + esc(d.primary) + "</b>" + (d.secondary ? " (보조: " + esc(d.secondary) + ")" : "") +
      '<div class="hint">고르신 방 분위기 ' + state.picks.length + "개를 보고 취향을 추정했어요. 추천 순서는 스타일 일치, 아쉬운 점으로 답하거나 적으신 항목, 생활에 먼저 필요한 정도(필요도), 방 크기를 점수로 합산해 정했어요. 가격은 실제 판매가가 아니라 참고용 추정값이에요.</div>" +
      notes.map(function (t) { return '<div class="note">' + esc(t) + "</div>"; }).join("") + "</div>";
    if (!state.groups.length) {
      $("#suggestions").innerHTML = "<p>이미 갖고 있다고 체크한 항목이 전부라 더 추천할 게 없어요. 1단계에서 체크를 줄여 보세요.</p>";
    } else {
      $("#suggestions").innerHTML = state.groups.map(function (_, g) { return cardHtml(g); }).join("");
    }
    $("#autoLog").innerHTML = state.autoLog.length
      ? '<div class="log"><h3>에이전트의 판단 과정 (자동 선택)</h3><ul>' + state.autoLog.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul></div>" : "";
    updateCart();
  }

  function updateCart() {
    state.selected = [];
    state.groups.forEach(function (_, g) { if (state.picked[g]) state.selected.push(currentOption(g).item); });
    var total = state.selected.reduce(function (s, it) { return s + it.price; }, 0);
    var diff = state.budget - total, over = diff < 0;
    var nail = state.selected.filter(function (it) { return !it.noDrill; }).length;
    var fb = Agent.floorBudget(state.room, state.owned);
    var used = state.selected.reduce(function (s, it) { return s + Agent.footprint(it); }, 0);
    var floorOver = !!fb && used > fb.remaining;
    $("#cartBar").className = "cart-bar" + (over || floorOver ? " over" : "");
    $("#cartBar").innerHTML = "<div>담은 상품 <b>" + state.selected.length + "개</b> · 합계 약 <b>" + won(total) + "</b> / 예산 " + won(state.budget) +
      " · " + (over ? "<b>예산 " + won(-diff) + " 초과</b>" : "남은 예산 " + won(diff)) + "</div>" +
      (fb ? "<div>바닥 사용 약 " + m2(used) + "㎡ / 남은 여유 약 " + m2(fb.remaining) + "㎡" + (floorOver ? " · <b>방에 비해 가구가 많아요</b>" : "") + "</div>" : "") +
      (nail ? '<div class="hint">벽에 못이 필요할 수 있는 상품 ' + nail + "개 (퇴실 때 원상복구 주의)</div>" : "");
    $("#to4").disabled = state.selected.length === 0;
  }

  function autoPick() {
    state.budget = budgetValue("#budget3");
    var r = Agent.recommend(state.items, { budget: state.budget, owned: state.owned, diagnosis: state.diagnosis, room: state.room });
    state.picked = state.groups.map(function () { return false; });
    r.picked.forEach(function (p) {
      for (var g = 0; g < state.groups.length; g++) {
        for (var k = 0; k < state.groups[g].options.length; k++) {
          if (state.groups[g].options[k].item.id === p.item.id) { state.current[g] = k; state.picked[g] = true; }
        }
      }
    });
    state.autoLog = r.tooLow
      ? ["예산 " + won(r.budget) + "으로는 살 수 있는 항목이 없어요. 가장 저렴한 항목이 " + won(r.minPrice) + "이에요."]
      : (r.log.length ? r.log : ["예산 안에서 추천 순서대로 담았어요."]);
    renderStep3();
  }

  function bindStep3() {
    $("#suggestions").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b || !b.dataset.act) return;
      var g = +b.dataset.g;
      if (b.dataset.act === "pick") state.picked[g] = !state.picked[g];
      else if (b.dataset.act === "more") state.open[g] = !state.open[g];
      else if (b.dataset.act === "alt") { state.current[g] = +b.dataset.o; state.open[g] = false; }
      renderStep3();
    });
    $("#budget3").addEventListener("input", function () { state.budget = budgetValue("#budget3"); updateCart(); });
    $("#autoPick").addEventListener("click", autoPick);
  }

  // ---- 4. 배치
  function renderPalette() {
    $("#palette").innerHTML = state.selected.map(function (it, i) {
      return '<button type="button" data-i="' + i + '" title="' + esc(it.name) + '"><img src="' + esc(it.image) + '" alt="' + esc(it.name) + '"></button>';
    }).join("");
  }

  function startOverlay() {
    Overlay.clear();
    renderPalette();
    if (state.photoURL) {
      var img = new Image();
      img.onload = function () { Overlay.setBackground(img); };
      img.src = state.photoURL;
    } else { Overlay.setBackground(null); }
    showStep(4);
  }

  function bindStep4() {
    Overlay.init($("#room"));
    $("#palette").addEventListener("click", function (e) {
      var btn = e.target.closest("button");
      if (btn) Overlay.addItem(state.selected[+btn.dataset.i]);
    });
    $("#savePng").addEventListener("click", function () {
      Overlay.toBlob(function (blob) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = "my-room.png"; a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      });
    });
  }

  // ---- 시작
  function init() {
    bindStep1(); renderQuestions(); bindMood(); bindStep3(); bindStep4();
    bindInterpretation();
    LLM.init().then(renderInterpretation);
    $("#back1").addEventListener("click", function () { showStep(1); });
    $("#to3").addEventListener("click", runAgent);
    $("#back2").addEventListener("click", function () { showStep(2); });
    $("#to4").addEventListener("click", startOverlay);
    $("#back3").addEventListener("click", function () { showStep(3); });
    showStep(1);
    Promise.all([fetch("data/items.json?v=20261027f").then(function (r) { return r.json(); }),
                 fetch("data/moods.json?v=20261027f").then(function (r) { return r.json(); })])
      .then(function (res) { state.items = res[0]; state.moods = res[1]; renderMood(); })
      .catch(function () { $("#loadError").hidden = false; $("#to2").disabled = true; });
  }
  init();
})();
