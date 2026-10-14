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
    var ratio = it.view === "top" ? (it.size.d / it.size.w) * TOP_VIEW_SQUASH : it.size.h / it.size.w;
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
      if (p.img.complete && p.img.naturalWidth) ctx.drawImage(p.img, -d.w / 2, -d.h / 2, d.w, d.h);
      if (p === selected) {
        ctx.strokeStyle = "#3d5a4c"; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
        ctx.strokeRect(-d.w / 2 - 3, -d.h / 2 - 3, d.w + 6, d.h + 6);
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

  function onDown(e) {
    var pt = pointer(e), found = null;
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
  function clear() { placed = []; select(null); }

  function toBlob(cb) {
    var prev = selected; selected = null; draw();   // 저장본에는 선택 테두리를 넣지 않는다
    canvas.toBlob(function (b) { selected = prev; draw(); cb(b); }, "image/png");
  }

  return { init: init, resize: resize, setBackground: setBackground, addItem: addItem,
           setScale: setScale, setRotation: setRotation, removeSelected: removeSelected,
           clear: clear, toBlob: toBlob };
})();
