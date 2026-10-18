// 사진 위 가구 배치: Canvas에 사진을 깔고 SVG 가구를 끌어서 옮기고 크기/회전을 조절한다.
var Overlay = (function () {
  "use strict";

  var ROOM_WIDTH_CM = 320;    // 사진 속 방 너비를 약 3.2m로 가정해 가구 실제 치수를 화면 크기로 환산
  var TOP_VIEW_SQUASH = 0.45; // 러그·침구(위에서 본 그림)는 바닥에 깔린 느낌이 나도록 세로를 눌러서 그린다

  var canvas, ctx, W = 0, H = 0, dpr = 1;
  var bg = null;
  var placed = [];
  var selected = null;
  var drag = null;
  var onSelect = function () {};
  var images = {};
  var HANDLE_R = 11;     // 삭제 버튼 반지름 (그리는 크기)
  var HANDLE_HIT_R = 18; // 손가락으로 누르기 쉽게 판정 영역은 더 넓게

  function loadImage(src) {
    if (images[src]) return images[src];
    var img = new Image();
    img.onload = draw;
    img.src = src;
    images[src] = img;
    return img;
  }

  function init(canvasEl, selectCallback) {
    canvas = canvasEl;
    ctx = canvas.getContext("2d");
    onSelect = selectCallback || onSelect;
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    window.addEventListener("resize", function () { resize(); });
    resize();
  }

  // 방 사진 비율에 맞춰 캔버스 크기를 정한다. 사진이 없으면 4:3
  function resize() {
    var w = Math.min(canvas.parentElement.clientWidth || 640, 720);
    var ratio = bg && bg.naturalWidth ? bg.naturalHeight / bg.naturalWidth : 0.75;
    dpr = window.devicePixelRatio || 1;
    W = w; H = Math.round(w * ratio);
    canvas.width = W * dpr; canvas.height = H * dpr;
    canvas.style.height = H + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function setBackground(img) { bg = img || null; resize(); }

  function pxPerCm() { return W / ROOM_WIDTH_CM; }

  function dims(p) {
    var it = p.item;
    var w = it.size.w * pxPerCm() * p.scale;
    // 실제 상품 사진은 촬영 각도 때문에 치수 비율과 그림 비율이 달라서, 데이터의 사진 비율(aspect)대로 그려 찌그러짐을 막는다
    // 러그처럼 위에서 찍은 사진(view=top)은 바닥에 깔린 느낌이 나도록 세로를 눌러서 그린다
    var ratio = it.aspect * (it.view === "top" ? TOP_VIEW_SQUASH : 1);
    return { w: w, h: w * ratio };
  }

  function addItem(item) {
    var p = { item: item, img: loadImage(item.image), x: W / 2, y: H * 0.6, scale: 1, rot: 0 };
    placed.push(p);
    select(p);
    draw();
  }

  function select(p) { selected = p; onSelect(p); draw(); }

  function drawBackground() {
    if (bg && bg.naturalWidth) { ctx.drawImage(bg, 0, 0, W, H); return; }
    ctx.fillStyle = "#e9e4da"; ctx.fillRect(0, 0, W, H * 0.7);
    ctx.fillStyle = "#cdbfa8"; ctx.fillRect(0, H * 0.7, W, H * 0.3);
    ctx.fillStyle = "#8a8579"; ctx.font = "13px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("방 사진이 없어서 기본 배경이에요", W / 2, 22);
  }

  function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    drawBackground();
    placed.forEach(function (p) {
      var d = dims(p);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * Math.PI / 180);
      // SVG는 브라우저에 따라 naturalWidth가 0으로 나올 수 있어 크기를 직접 지정해 그린다. 로딩 실패(깨진 이미지)면 건너뛴다
      // 흰 상품이 밝은 배경에 묻히지 않도록 옅은 그림자를 준다
      ctx.shadowColor = "rgba(0,0,0,0.28)"; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
      if (p.img.complete) { try { ctx.drawImage(p.img, -d.w / 2, -d.h / 2, d.w, d.h); } catch (e) { /* 아직 못 읽은 이미지 */ } }
      ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      if (p === selected) {
        ctx.strokeStyle = "#3d5a4c"; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
        ctx.strokeRect(-d.w / 2 - 3, -d.h / 2 - 3, d.w + 6, d.h + 6);
        ctx.setLineDash([]);
        ctx.fillStyle = "#c0392b";
        ctx.beginPath(); ctx.arc(d.w / 2 + 3, -d.h / 2 - 3, HANDLE_R, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
        var cx = d.w / 2 + 3, cy = -d.h / 2 - 3, k = HANDLE_R * 0.4;
        ctx.beginPath(); ctx.moveTo(cx - k, cy - k); ctx.lineTo(cx + k, cy + k);
        ctx.moveTo(cx + k, cy - k); ctx.lineTo(cx - k, cy + k); ctx.stroke();
      }
      ctx.restore();
    });
  }

  function pointer(e) {
    var r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
  }

  function hit(p, pt) {
    var d = dims(p), a = -p.rot * Math.PI / 180;
    var dx = pt.x - p.x, dy = pt.y - p.y;
    var lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    return Math.abs(lx) <= d.w / 2 && Math.abs(ly) <= d.h / 2;
  }

  // 선택된 가구의 점선 오른쪽 위 모서리에 있는 삭제 버튼을 눌렀는지 (회전 반영)
  function hitDeleteHandle(pt) {
    if (!selected) return false;
    var d = dims(selected), a = selected.rot * Math.PI / 180;
    var lx = d.w / 2 + 3, ly = -d.h / 2 - 3;
    var hx = selected.x + lx * Math.cos(a) - ly * Math.sin(a);
    var hy = selected.y + lx * Math.sin(a) + ly * Math.cos(a);
    return Math.hypot(pt.x - hx, pt.y - hy) <= HANDLE_HIT_R;
  }

  function onDown(e) {
    var pt = pointer(e), found = null;
    if (hitDeleteHandle(pt)) { removeSelected(); return; }
    for (var i = placed.length - 1; i >= 0; i--) { if (hit(placed[i], pt)) { found = placed[i]; break; } }
    if (found) {
      placed.splice(placed.indexOf(found), 1); placed.push(found); // 눌러서 맨 앞으로
      select(found);
      drag = { dx: pt.x - found.x, dy: pt.y - found.y };
      canvas.setPointerCapture(e.pointerId);
    } else { select(null); }
  }
  function onMove(e) {
    if (!drag || !selected) return;
    var pt = pointer(e);
    selected.x = Math.max(0, Math.min(W, pt.x - drag.dx));
    selected.y = Math.max(0, Math.min(H, pt.y - drag.dy));
    draw();
  }
  function onUp() { drag = null; }

  function setScale(v) { if (selected) { selected.scale = v; draw(); } }
  function setRotation(v) { if (selected) { selected.rot = v; draw(); } }
  function removeSelected() {
    if (!selected) return;
    placed.splice(placed.indexOf(selected), 1);
    select(null);
  }
  function count() { return placed.length; }
  function handlePos() { // 스모크 테스트용: 선택된 가구의 삭제 버튼 좌표
    var d = dims(selected), a = selected.rot * Math.PI / 180, lx = d.w / 2 + 3, ly = -d.h / 2 - 3;
    return { x: selected.x + lx * Math.cos(a) - ly * Math.sin(a), y: selected.y + lx * Math.sin(a) + ly * Math.cos(a), W: W, H: H };
  }
  function clear() { placed = []; select(null); }

  function toBlob(cb) {
    var prev = selected; selected = null; draw();   // 저장본에는 선택 테두리를 넣지 않는다
    canvas.toBlob(function (b) { selected = prev; draw(); cb(b); }, "image/png");
  }

  return { init: init, resize: resize, setBackground: setBackground, addItem: addItem,
           setScale: setScale, setRotation: setRotation, removeSelected: removeSelected,
           clear: clear, toBlob: toBlob, count: count, handlePos: handlePos };
})();
