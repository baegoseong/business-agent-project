// 사진 위 가구 배치: Canvas에 사진을 깔고 상품 이미지를 끌어서 옮기고, 선택하면 나오는 모서리 핸들로 크기·회전·삭제를 한다.
var Overlay = (function () {
  "use strict";

  var ROOM_WIDTH_CM = 320;    // 사진 속 방 너비를 약 3.2m로 가정해 가구 실제 치수를 화면 크기로 환산
  var TOP_VIEW_SQUASH = 0.45; // 러그처럼 위에서 찍은 사진은 바닥에 깔린 느낌이 나도록 세로를 눌러서 그린다
  var PAD = 3;                // 점선 테두리와 상품 사이 간격
  var HANDLE_R = 13;          // 핸들을 그리는 반지름
  var HANDLE_HIT_R = 22;      // 손가락으로 누르기 쉽게 판정 영역은 더 넓게
  var ROTATE_OFFSET = 30;     // 회전 핸들이 위쪽 테두리에서 떨어진 거리
  var MIN_SCALE = 0.2, MAX_SCALE = 4;
  var SNAP_DEG = 4;           // 0°, 90° 근처에서 각도가 붙는 범위
  var COLOR = { accent: "#3d5a4c", del: "#c0392b" };

  var canvas, ctx, W = 0, H = 0, dpr = 1;
  var bg = null;
  var placed = [];
  var selected = null;
  var drag = null;            // { mode: "move" | "scale" | "rotate", ... }
  var onSelect = function () {};
  var images = {};

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
  }

  function select(p) { selected = p; onSelect(p); draw(); }

  // ---- 핸들 위치: 상품 중심 기준(로컬) 좌표 -> 캔버스 좌표 (회전 반영)
  function localHandles(d) {
    return {
      del:    { x: d.w / 2 + PAD, y: -d.h / 2 - PAD },
      scale:  { x: d.w / 2 + PAD, y: d.h / 2 + PAD },
      rotate: { x: 0,             y: -d.h / 2 - PAD - ROTATE_OFFSET }
    };
  }
  function toCanvas(p, l) {
    var a = p.rot * Math.PI / 180;
    return { x: p.x + l.x * Math.cos(a) - l.y * Math.sin(a), y: p.y + l.x * Math.sin(a) + l.y * Math.cos(a) };
  }
  function handlePositions(p) {
    var lh = localHandles(dims(p)), out = {};
    Object.keys(lh).forEach(function (k) { out[k] = toCanvas(p, lh[k]); });
    return out;
  }
  function handleAt(pt) {
    if (!selected) return null;
    var hp = handlePositions(selected);
    var order = ["del", "scale", "rotate"];
    for (var i = 0; i < order.length; i++) {
      if (Math.hypot(pt.x - hp[order[i]].x, pt.y - hp[order[i]].y) <= HANDLE_HIT_R) return order[i];
    }
    return null;
  }

  // ---- 그리기
  function circle(x, y, color) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, HANDLE_R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.stroke();
  }
  function iconDelete(x, y) {
    var k = HANDLE_R * 0.38;
    ctx.beginPath(); ctx.moveTo(x - k, y - k); ctx.lineTo(x + k, y + k); ctx.moveTo(x + k, y - k); ctx.lineTo(x - k, y + k); ctx.stroke();
  }
  function iconScale(x, y) {          // 대각선 양방향 화살표
    var k = HANDLE_R * 0.42, h = HANDLE_R * 0.3;
    ctx.beginPath();
    ctx.moveTo(x - k, y + k); ctx.lineTo(x + k, y - k);
    ctx.moveTo(x + k, y - k); ctx.lineTo(x + k - h, y - k); ctx.moveTo(x + k, y - k); ctx.lineTo(x + k, y - k + h);
    ctx.moveTo(x - k, y + k); ctx.lineTo(x - k + h, y + k); ctx.moveTo(x - k, y + k); ctx.lineTo(x - k, y + k - h);
    ctx.stroke();
  }
  function iconRotate(x, y) {         // 원호 화살표
    var r = HANDLE_R * 0.42;
    ctx.beginPath(); ctx.arc(x, y, r, Math.PI * 0.25, Math.PI * 1.75); ctx.stroke();
    var ex = x + r * Math.cos(Math.PI * 1.75), ey = y + r * Math.sin(Math.PI * 1.75);
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex + 4, ey + 1); ctx.moveTo(ex, ey); ctx.lineTo(ex + 1, ey + 4.5); ctx.stroke();
  }

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
        var h = localHandles(d);
        ctx.strokeStyle = COLOR.accent; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
        ctx.strokeRect(-d.w / 2 - PAD, -d.h / 2 - PAD, d.w + PAD * 2, d.h + PAD * 2);
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(0, -d.h / 2 - PAD); ctx.lineTo(h.rotate.x, h.rotate.y); ctx.stroke();   // 회전 핸들 줄
        circle(h.del.x, h.del.y, COLOR.del);       ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; iconDelete(h.del.x, h.del.y);
        circle(h.scale.x, h.scale.y, COLOR.accent); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; iconScale(h.scale.x, h.scale.y);
        circle(h.rotate.x, h.rotate.y, COLOR.accent); ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; iconRotate(h.rotate.x, h.rotate.y);
      }
      ctx.restore();
    });
  }

  // ---- 입력
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

  function normalizeDeg(v) { while (v > 180) v -= 360; while (v < -180) v += 360; return v; }
  function snapDeg(v) {
    var near = Math.round(v / 90) * 90;
    return Math.abs(v - near) <= SNAP_DEG ? normalizeDeg(near) : v;
  }

  function onDown(e) {
    var pt = pointer(e), found = null, handle = handleAt(pt);
    if (handle === "del") { removeSelected(); return; }
    if (handle === "scale") {
      drag = { mode: "scale", startDist: Math.max(10, Math.hypot(pt.x - selected.x, pt.y - selected.y)), startScale: selected.scale };
      canvas.setPointerCapture(e.pointerId); return;
    }
    if (handle === "rotate") {
      drag = { mode: "rotate", startAngle: Math.atan2(pt.y - selected.y, pt.x - selected.x), startRot: selected.rot };
      canvas.setPointerCapture(e.pointerId); return;
    }
    for (var i = placed.length - 1; i >= 0; i--) { if (hit(placed[i], pt)) { found = placed[i]; break; } }
    if (found) {
      placed.splice(placed.indexOf(found), 1); placed.push(found); // 눌러서 맨 앞으로
      select(found);
      drag = { mode: "move", dx: pt.x - found.x, dy: pt.y - found.y };
      canvas.setPointerCapture(e.pointerId);
    } else { select(null); }
  }

  function onMove(e) {
    var pt = pointer(e);
    if (!drag || !selected) {                    // 끄는 중이 아닐 때는 마우스 커서 모양으로 핸들을 알려 준다
      var h = handleAt(pt);
      canvas.style.cursor = h === "del" ? "pointer" : h === "scale" ? "nwse-resize" : h === "rotate" ? "grab"
        : placed.some(function (p) { return hit(p, pt); }) ? "move" : "default";
      return;
    }
    if (drag.mode === "move") {
      selected.x = Math.max(0, Math.min(W, pt.x - drag.dx));
      selected.y = Math.max(0, Math.min(H, pt.y - drag.dy));
    } else if (drag.mode === "scale") {
      var dist = Math.hypot(pt.x - selected.x, pt.y - selected.y);
      selected.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, drag.startScale * dist / drag.startDist));
    } else if (drag.mode === "rotate") {
      var ang = Math.atan2(pt.y - selected.y, pt.x - selected.x);
      selected.rot = snapDeg(normalizeDeg(drag.startRot + (ang - drag.startAngle) * 180 / Math.PI));
    }
    draw();
  }
  function onUp() { drag = null; }

  function removeSelected() {
    if (!selected) return;
    placed.splice(placed.indexOf(selected), 1);
    select(null);
  }
  function clear() { placed = []; select(null); }

  function toBlob(cb) {
    var prev = selected; selected = null; draw();   // 저장본에는 선택 테두리와 핸들을 넣지 않는다
    canvas.toBlob(function (b) { selected = prev; draw(); cb(b); }, "image/png");
  }

  // 테스트용: 선택된 상품의 상태와 핸들의 캔버스 좌표
  function inspect() {
    return { count: placed.length, W: W, H: H,
      selected: selected ? { scale: selected.scale, rot: selected.rot, x: selected.x, y: selected.y, handles: handlePositions(selected) } : null };
  }

  return { init: init, resize: resize, setBackground: setBackground, addItem: addItem,
           removeSelected: removeSelected, clear: clear, toBlob: toBlob, inspect: inspect };
})();
