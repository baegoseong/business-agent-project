// 화면 흐름: 1 방 정보 -> 2 취향 -> 3 추천 상품 고르기(예산 맞추기) -> 4 사진 위 배치
(function () {
  "use strict";

  var QUESTIONS = [
    { id: "mood", title: "어떤 분위기가 끌려요?", multi: false, options: [
      { label: "밝고 깔끔한 화이트톤", styles: { "미니멀": 2, "모던": 1 } },
      { label: "포근하고 따뜻한 느낌", styles: { "따뜻한": 2, "우드": 1 } },
      { label: "나무 질감의 내추럴함", styles: { "우드": 2, "따뜻한": 1 } },
      { label: "세련된 도시적 분위기", styles: { "모던": 2, "미니멀": 1 } } ] },
    { id: "color", title: "좋아하는 색감은요?", multi: false, options: [
      { label: "화이트 · 그레이", styles: { "미니멀": 1, "모던": 1 } },
      { label: "베이지 · 브라운", styles: { "따뜻한": 1, "우드": 1 } },
      { label: "블랙 · 차콤 포인트", styles: { "모던": 2 } },
      { label: "우드톤 + 초록 식물", styles: { "우드": 2 } } ] },
    { id: "need", title: "지금 방에서 아쉬운 점은? (여러 개 선택 가능)", multi: true, options: [
      { label: "물건 둘 곳이 부족해요", needs: ["선반", "수납장", "수납 박스", "바구니", "신발 선반"] },
      { label: "방이 어두워요", needs: ["조명"] },
      { label: "휑하고 허전해요", needs: ["꽃병", "화분", "소품", "벽장식", "시계", "거울", "쿠션"] },
      { label: "바닥이 차갑고 밋밋해요", needs: ["러그"] },
      { label: "앉을 곳이 아쉬워요", needs: ["의자", "스툴", "벤치", "소파"] },
      { label: "잠자리가 아쉬워요", needs: ["침구", "침대 프레임"] },
      { label: "작업할 책상이 아쉬워요", needs: ["책상", "테이블"] } ] }
  ];

  var state = {
    items: [], photoURL: null,
    diagnosis: null, owned: [], budget: 0,
    groups: [],      // Agent.suggest 결과: 카테고리별 후보 목록
    current: [],     // 카테고리마다 지금 보여 주는 후보의 위치
    picked: [],      // 카테고리마다 담았는지
    open: [],        // 카테고리마다 '다른 상품 보기'가 펼쳐졌는지
    selected: [],    // 담은 상품 (4단계로 넘어갈 목록)
    autoLog: []
  };
  var $ = function (sel) { return document.querySelector(sel); };
  var won = function (n) { return n.toLocaleString("ko-KR") + "원"; };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };

  function showStep(n) {
    for (var i = 1; i <= 4; i++) $("#step" + i).hidden = (i !== n);
    var lis = document.querySelectorAll("#steps li");
    for (var j = 0; j < lis.length; j++) lis[j].classList.toggle("on", j === n - 1);
    if (n === 4) Overlay.resize();
    window.scrollTo(0, 0);
  }

  // ---- 1. 방 정보
  function budgetValue(sel) { return Math.max(0, parseInt($(sel).value, 10) || 0); }

  function bindStep1() {
    $("#budgetChips").addEventListener("click", function (e) {
      if (e.target.dataset.v) $("#budget").value = e.target.dataset.v;
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

  // ---- 2. 취향
  function renderQuestions() {
    $("#questions").innerHTML = QUESTIONS.map(function (q) {
      return '<fieldset class="q"><legend>' + esc(q.title) + "</legend>" + q.options.map(function (o, i) {
        return '<label class="opt"><input type="' + (q.multi ? "checkbox" : "radio") + '" name="' + q.id +
          '" value="' + i + '"> ' + esc(o.label) + "</label>";
      }).join("") + "</fieldset>";
    }).join("");
  }

  function selectedOptions() {
    var out = [], missing = false;
    QUESTIONS.forEach(function (q) {
      var checked = document.querySelectorAll('input[name="' + q.id + '"]:checked');
      if (!checked.length && !q.multi) missing = true;
      for (var i = 0; i < checked.length; i++) out.push(q.options[+checked[i].value]);
    });
    return { options: out, missing: missing };
  }

  // ---- 3. 추천 상품 고르기
  function runAgent() {
    var sel = selectedOptions();
    if (sel.missing) { $("#q-error").textContent = "분위기와 색감 질문에 답해 주세요."; $("#q-error").hidden = false; return; }
    $("#q-error").hidden = true;
    // 체크 항목 하나가 여러 카테고리를 뜻할 수 있어(예: 수납 가구 = 선반, 수납장) 쉼표로 이어 둔 값을 펼친다
    state.owned = [];
    Array.prototype.forEach.call(document.querySelectorAll("#ownedChecks input:checked"), function (c) { state.owned = state.owned.concat(c.value.split(",")); });
    state.diagnosis = Agent.diagnose(sel.options);
    state.groups = Agent.suggest(state.items, { owned: state.owned, diagnosis: state.diagnosis });
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
    var others = grp.options.length - 1;
    var h = '<div class="card' + (on ? " on" : "") + '"><div class="item"><div class="thumb"><img src="' + esc(it.image) + '" alt=""></div><div class="body">' +
      '<div class="name">' + esc(it.name) + (state.current[g] === 0 ? '<span class="badge top">추천 1순위</span>' : "") + "</div>" +
      (it.brand ? '<div class="brand">' + esc(it.brand) + "</div>" : "") +
      '<div class="price">약 ' + won(it.price) + " · " + esc(it.category) + "</div>" +
      (opt.reasons.length ? "<ul>" + opt.reasons.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>" : "") +
      '<div class="card-actions"><button type="button" class="pick' + (on ? " on" : "") + '" data-act="pick" data-g="' + g + '">' + (on ? "✓ 담음 (누르면 빼기)" : "담기") + "</button>" +
      (others ? '<button type="button" data-act="more" data-g="' + g + '">' + (state.open[g] ? "접기" : "같은 종류 다른 상품 " + others + "개 보기") + "</button>" : "") +
      "</div></div></div>";
    if (state.open[g]) {
      h += '<div class="alts">' + grp.options.map(function (o, k) {
        if (k === state.current[g]) return "";
        return '<button type="button" class="alt" data-act="alt" data-g="' + g + '" data-o="' + k + '"><img src="' + esc(o.item.image) + '" alt="">' +
          "<span>" + esc(o.item.name) + "</span><b>약 " + won(o.item.price) + "</b></button>";
      }).join("") + "</div>";
    }
    return h + "</div>";
  }

  function renderStep3() {
    var d = state.diagnosis;
    $("#diag").innerHTML = '<div class="summary"><b>진단 결과: ' + esc(d.primary) + "</b>" + (d.secondary ? " (보조: " + esc(d.secondary) + ")" : "") +
      '<div class="hint">추천 순서는 고르신 스타일과의 일치, 아쉬운 점으로 답하신 항목, 생활에 먼저 필요한 정도(필요도), 못 없이 설치할 수 있는지를 점수로 합산해 정했어요. 가격은 실제 판매가가 아니라 참고용 추정값이에요.</div></div>';
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
    $("#cartBar").className = "cart-bar" + (over ? " over" : "");
    $("#cartBar").innerHTML = "<div>담은 상품 <b>" + state.selected.length + "개</b> · 합계 약 <b>" + won(total) + "</b> / 예산 " + won(state.budget) +
      " · " + (over ? "<b>예산 " + won(-diff) + " 초과</b>" : "남은 예산 " + won(diff)) + "</div>" +
      (nail ? '<div class="hint">벽에 못이 필요할 수 있는 상품 ' + nail + "개 (퇴실 때 원상복구 주의)</div>" : "");
    $("#to4").disabled = state.selected.length === 0;
  }

  function autoPick() {
    state.budget = budgetValue("#budget3");
    var r = Agent.recommend(state.items, { budget: state.budget, owned: state.owned, diagnosis: state.diagnosis });
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
    Overlay.init($("#room"), function (p) {
      $("#controls").hidden = !p;
      if (p) { $("#ctlScale").value = p.scale; $("#ctlRot").value = p.rot; }
    });
    $("#palette").addEventListener("click", function (e) {
      var btn = e.target.closest("button");
      if (btn) Overlay.addItem(state.selected[+btn.dataset.i]);
    });
    $("#ctlScale").addEventListener("input", function (e) { Overlay.setScale(+e.target.value); });
    $("#ctlRot").addEventListener("input", function (e) { Overlay.setRotation(+e.target.value); });
    $("#ctlDelete").addEventListener("click", Overlay.removeSelected);
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
    bindStep1(); renderQuestions(); bindStep3(); bindStep4();
    $("#back1").addEventListener("click", function () { showStep(1); });
    $("#to3").addEventListener("click", runAgent);
    $("#back2").addEventListener("click", function () { showStep(2); });
    $("#to4").addEventListener("click", startOverlay);
    $("#back3").addEventListener("click", function () { showStep(3); });
    showStep(1);
    fetch("data/items.json").then(function (r) { return r.json(); })
      .then(function (d) { state.items = d; })
      .catch(function () { $("#loadError").hidden = false; $("#to2").disabled = true; });
  }
  init();
})();
