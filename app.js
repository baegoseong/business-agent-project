// 화면 흐름: 1 방 정보 -> 2 취향 -> 3 추천 -> 4 사진 위 배치
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
      { label: "물건 둘 곳이 부족해요", needs: ["수납"] },
      { label: "방이 어두워요", needs: ["조명"] },
      { label: "휑하고 허전해요", needs: ["소품", "벽장식"] },
      { label: "바닥이 차갑고 밋밋해요", needs: ["러그"] },
      { label: "창가가 허전해요", needs: ["커튼"] },
      { label: "잠자리가 아쉬워요", needs: ["침구"] } ] }
  ];

  var state = { items: [], photoURL: null, result: null };
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
  function budgetValue() { return Math.max(0, parseInt($("#budget").value, 10) || 0); }

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

  // ---- 3. 추천
  function runAgent() {
    var sel = selectedOptions();
    if (sel.missing) { $("#q-error").textContent = "분위기와 색감 질문에 답해 주세요."; $("#q-error").hidden = false; return; }
    $("#q-error").hidden = true;
    var owned = Array.prototype.map.call(document.querySelectorAll("#ownedChecks input:checked"), function (c) { return c.value; });
    var diagnosis = Agent.diagnose(sel.options);
    state.result = Agent.recommend(state.items, { budget: budgetValue(), owned: owned, diagnosis: diagnosis });
    state.result.diagnosis = diagnosis;
    renderResult();
    showStep(3);
  }

  function renderResult() {
    var r = state.result, box = $("#result"), d = r.diagnosis;
    var head = '<div class="summary"><b>진단 결과: ' + esc(d.primary) + "</b>" +
      (d.secondary ? " (보조: " + esc(d.secondary) + ")" : "") + "</div>";

    if (r.nothingToBuy) {
      box.innerHTML = head + "<p>이미 갖고 있다고 체크한 항목이 전부라 더 추천할 게 없어요. 1단계에서 체크를 줄여 보세요.</p>";
      $("#to4").hidden = true; return;
    }
    if (r.tooLow) {
      box.innerHTML = head + '<p class="error">예산 ' + won(r.budget) + "으로는 살 수 있는 항목이 없어요. 가장 저렴한 항목이 " +
        won(r.minPrice) + "이에요. 1단계에서 예산을 올려 주세요.</p>";
      $("#to4").hidden = true; return;
    }
    $("#to4").hidden = false;

    var pct = r.budget ? Math.min(100, Math.round(r.total / r.budget * 100)) : 0;
    var items = r.picked.map(function (p) {
      var it = p.item;
      return '<div class="item"><div class="thumb"><img src="' + esc(it.image) + '" alt=""></div><div>' +
        '<div class="name">' + esc(it.name) + (p.replacedFrom ? '<span class="badge">대체</span>' : "") + "</div>" +
        '<div class="price">' + won(it.price) + " · " + esc(it.category) + "</div>" +
        "<ul>" + p.reasons.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul></div></div>";
    }).join("");

    var logHtml = r.log.length
      ? '<div class="log"><h3>에이전트의 판단 과정</h3><ul>' + r.log.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul></div>"
      : "";

    box.innerHTML = head +
      '<div class="summary">총 <b>' + won(r.total) + "</b> / 예산 " + won(r.budget) + " (남은 예산 " + won(r.leftover) +
      ')<div class="bar"><span style="width:' + pct + '%"></span></div>' +
      '<div class="hint">모두 못·타공 없이 설치할 수 있는 제품이라 퇴실 때 원상복구 부담이 없어요.</div></div>' +
      items + logHtml;
  }

  // ---- 4. 배치
  function renderPalette() {
    $("#palette").innerHTML = state.result.picked.map(function (p, i) {
      return '<button type="button" data-i="' + i + '" title="' + esc(p.item.name) + '"><img src="' + esc(p.item.image) + '" alt="' + esc(p.item.name) + '"></button>';
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
      if (btn) Overlay.addItem(state.result.picked[+btn.dataset.i].item);
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
    bindStep1(); renderQuestions(); bindStep4();
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
