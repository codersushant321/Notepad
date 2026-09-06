document.getElementById('get-started-btn').addEventListener('click', () => {
  document.getElementById('welcome-screen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    initCanvasForActivePage();
    loadWriteInkForPage(getActivePage());
    autoGrowTextarea();
  }));
});

/* ================= PAGES ================= */
let pageIdCounter = 1;
function newPageObj(name){
  return { id: pageIdCounter++, name: name, text: "", canvasDataURL: null, canvasHeight: 1400, writeInkDataURL: null, writeInkHeight: 900 };
}
let pages = [ newPageObj("Page 1") ];
let activePageId = pages[0].id;

function getActivePage(){ return pages.find(p => p.id === activePageId); }

function renderPageList(){
  const list = document.getElementById('pages-list');
  list.innerHTML = "";
  pages.forEach(p => {
    const item = document.createElement('div');
    item.className = 'page-item' + (p.id === activePageId ? ' active' : '');
    const nameSpan = document.createElement('span');
    nameSpan.className = 'page-name';
    nameSpan.textContent = p.name;
    nameSpan.title = "Double-click to rename";
    nameSpan.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const newName = prompt("Rename page:", p.name);
      if(newName && newName.trim()){ p.name = newName.trim(); renderPageList(); }
    });
    const delBtn = document.createElement('button');
    delBtn.className = 'page-del';
    delBtn.textContent = '×';
    delBtn.title = "Delete page";
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if(pages.length === 1){ alert("You need at least one page."); return; }
      if(!confirm('Delete "' + p.name + '"? This cannot be undone.')) return;
      const idx = pages.findIndex(pp => pp.id === p.id);
      pages.splice(idx, 1);
      if(activePageId === p.id){
        const next = pages[Math.max(0, idx-1)];
        switchToPage(next.id);
      } else {
        renderPageList();
      }
    });
    item.appendChild(nameSpan);
    item.appendChild(delBtn);
    item.addEventListener('click', () => switchToPage(p.id));
    list.appendChild(item);
  });
}

function saveActivePageState(){
  const p = getActivePage();
  if(!p) return;
  p.text = document.getElementById('text-area').value;
  if(canvas.width > 0 && canvas.height > 0){
    p.canvasDataURL = canvas.toDataURL();
    p.canvasHeight = canvas.height;
  }
  if(winkCanvas.width > 0 && winkCanvas.height > 0){
    p.writeInkDataURL = winkCanvas.toDataURL();
    p.writeInkHeight = winkCanvas.height;
  }
}

function switchToPage(id){
  if(id === activePageId){ renderPageList(); return; }
  saveActivePageState();
  activePageId = id;
  loadActivePageIntoUI();
  renderPageList();
}

function loadActivePageIntoUI(){
  const p = getActivePage();
  const textarea = document.getElementById('text-area');
  textarea.value = p.text || "";
  autoGrowTextarea();
  strokes = [];
  resetProtractorState();
  loadCanvasForPage(p);
  winkStrokes = [];
  loadWriteInkForPage(p);
}

document.getElementById('add-page-btn').addEventListener('click', () => {
  saveActivePageState();
  const p = newPageObj("Page " + pageIdCounter);
  pages.push(p);
  activePageId = p.id;
  loadActivePageIntoUI();
  renderPageList();
});

/* ================= TABS ================= */
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('#write-pane, #draw-pane').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.pane).classList.add('active');
    if(tab.dataset.pane === 'draw-pane'){
      requestAnimationFrame(() => {
        if(canvas.width === 0) initCanvasForActivePage();
      });
    }
    if(tab.dataset.pane === 'write-pane'){
      requestAnimationFrame(() => {
        if(winkCanvas.width === 0) loadWriteInkForPage(getActivePage());
      });
    }
  });
});

/* ================= WRITE: AUTO-GROWING TEXTAREA ================= */
const textareaEl = document.getElementById('text-area');
function autoGrowTextarea(){
  textareaEl.style.height = 'auto';
  textareaEl.style.height = (textareaEl.scrollHeight + 4) + 'px';
}
textareaEl.addEventListener('input', autoGrowTextarea);
window.addEventListener('resize', autoGrowTextarea);

let lastCursorPos = 0;
['keyup','click','select','input'].forEach(evt => {
  textareaEl.addEventListener(evt, () => { lastCursorPos = textareaEl.selectionStart; });
});
function insertAtCursor(str){
  const val = textareaEl.value;
  const pos = lastCursorPos ?? val.length;
  textareaEl.value = val.slice(0, pos) + str + val.slice(pos);
  const newPos = pos + str.length;
  textareaEl.focus();
  textareaEl.setSelectionRange(newPos, newPos);
  lastCursorPos = newPos;
  autoGrowTextarea();
}

/* ================= DRAWING: INFINITE CANVAS + GEOMETRY TOOLS ================= */
const canvas = document.getElementById('draw-canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay-canvas');
const octx = overlay.getContext('2d');
const canvasWrap = document.getElementById('canvas-wrap');
const brushCursor = document.getElementById('brush-cursor');
const measureBadge = document.getElementById('measure-badge');
const toolHint = document.getElementById('tool-hint');

const GEOMETRY_TOOLS = ['ruler', 'compass', 'protractor'];
const PX_PER_CM = 37.795; // 96 CSS px per inch

const TOOL_HINTS = {
  pen: "Pen — draw freely. Pressure from your pen, finger, or trackpad changes the stroke width.",
  pencil: "Pencil — a lighter, semi-transparent line. Also pressure-sensitive.",
  eraser: "Eraser — rub out part of the page.",
  ruler: "Ruler — press anywhere and drag; a ruler appears under your finger showing the exact length.",
  compass: "Compass — press at the center, drag out to set the radius; the radius is shown live.",
  protractor: "Protractor — drag the first ray, release, then drag the second ray from the same point. The angle is measured automatically."
};

let currentTool = 'pen';
let currentColor = '#26241f';
let currentSize = 3;
let drawing = false;
let lastX = 0, lastY = 0;
let strokes = [];
let isExtending = false;
let shapeStart = null;

// smoothing buffer for natural, ink-like freehand strokes
let smoothP0 = null, smoothP1 = null;

// protractor state machine: 0 = idle, 1 = first ray drawn, waiting for second ray
let protractorStage = 0;
let protractorVertex = null;
let protractorAngle1 = null;

function resetProtractorState(){ protractorStage = 0; protractorVertex = null; protractorAngle1 = null; }

function syncOverlaySize(){
  overlay.width = canvas.width;
  overlay.height = canvas.height;
  overlay.style.width = canvas.style.width;
  overlay.style.height = canvas.style.height;
}

function initCanvasForActivePage(){
  const p = getActivePage();
  loadCanvasForPage(p);
}

function loadCanvasForPage(p){
  const wrapWidth = canvasWrap.clientWidth || 800;
  const wrapHeight = canvasWrap.clientHeight || 600;
  canvas.width = wrapWidth;
  canvas.height = Math.max(p.canvasHeight || 1400, wrapHeight);
  canvas.style.width = wrapWidth + 'px';
  canvas.style.height = canvas.height + 'px';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  syncOverlaySize();
  if(p.canvasDataURL){
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0);
    img.src = p.canvasDataURL;
  }
  canvasWrap.scrollTop = 0;
}

window.addEventListener('resize', () => {
  if(document.getElementById('draw-pane').classList.contains('active')){
    const dataURL = canvas.width ? canvas.toDataURL() : null;
    const wrapWidth = canvasWrap.clientWidth || 800;
    canvas.width = wrapWidth;
    canvas.style.width = wrapWidth + 'px';
    syncOverlaySize();
    if(dataURL){
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0);
      img.src = dataURL;
    }
  }
});

function extendCanvasDown(extra){
  if(isExtending) return;
  isExtending = true;
  const dataURL = canvas.toDataURL();
  const oldHeight = canvas.height;
  canvas.height = oldHeight + extra;
  canvas.style.height = canvas.height + 'px';
  syncOverlaySize();
  const img = new Image();
  img.onload = () => { ctx.drawImage(img, 0, 0); isExtending = false; };
  img.src = dataURL;
}

canvasWrap.addEventListener('scroll', () => {
  if(!document.getElementById('draw-pane').classList.contains('active')) return;
  const nearBottom = (canvasWrap.scrollTop + canvasWrap.clientHeight) >= (canvas.height - 260);
  if(nearBottom) extendCanvasDown(800);
});

function saveSnapshot(){
  if(canvas.width === 0 || canvas.height === 0) return;
  strokes.push(ctx.getImageData(0,0,canvas.width,canvas.height));
  if(strokes.length > 25) strokes.shift();
}

function getPos(e){
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

// pressure: pointer devices report 0..1. Mouse reports 0.5 while a button is held (0 otherwise);
// some touchscreens without force sensors report 0. Fall back to a sensible default in those cases.
function getPressure(e){
  if(typeof e.pressure === 'number' && e.pressure > 0) return e.pressure;
  return 0.5;
}
function widthForPressure(baseSize, pressure){
  return Math.max(0.6, baseSize * (0.35 + pressure * 1.3));
}

function applyFreehandStyleTo(targetCtx, tool, size, color, pressure){
  if(tool === 'eraser'){
    targetCtx.globalCompositeOperation = 'destination-out';
    targetCtx.lineWidth = widthForPressure(size, pressure) * 2.2;
    targetCtx.strokeStyle = 'rgba(0,0,0,1)';
    targetCtx.globalAlpha = 1;
  } else if(tool === 'pencil'){
    targetCtx.globalCompositeOperation = 'source-over';
    targetCtx.lineWidth = Math.max(1, widthForPressure(size, pressure) * 0.7);
    targetCtx.strokeStyle = color;
    targetCtx.globalAlpha = 0.35 + pressure * 0.4;
  } else {
    targetCtx.globalCompositeOperation = 'source-over';
    targetCtx.lineWidth = widthForPressure(size, pressure);
    targetCtx.strokeStyle = color;
    targetCtx.globalAlpha = 0.6 + pressure * 0.35;
  }
  targetCtx.lineCap = 'round';
  targetCtx.lineJoin = 'round';
}
function applyFreehandStyle(pressure){
  applyFreehandStyleTo(ctx, currentTool, currentSize, currentColor, pressure);
}

function maybeExtendForPosition(y){
  if(y > canvas.height - 200) extendCanvasDown(800);
}

/* ---- shape helpers ---- */
function clearOverlay(){ octx.clearRect(0,0,overlay.width, overlay.height); }

function showBadge(pos, text){
  measureBadge.textContent = text;
  measureBadge.style.left = (pos.x + 16) + 'px';
  measureBadge.style.top = (pos.y - 14) + 'px';
  measureBadge.style.opacity = 1;
}
function hideBadge(){ measureBadge.style.opacity = 0; }

// draws a real ruler strip (body + tick marks) along the current drag, like a physical ruler
function drawRulerPreview(start, end){
  const length = Math.hypot(end.x-start.x, end.y-start.y);
  const angle = Math.atan2(end.y-start.y, end.x-start.x);
  clearOverlay();
  octx.save();
  octx.translate(start.x, start.y);
  octx.rotate(angle);

  // translucent ruler body
  octx.fillStyle = 'rgba(250,248,241,0.85)';
  octx.strokeStyle = 'rgba(38,36,31,0.35)';
  octx.lineWidth = 1;
  octx.fillRect(0, -16, length, 32);
  octx.strokeRect(0, -16, length, 32);

  // tick marks every 10px, taller every 50px, with cm labels every 50px
  octx.strokeStyle = 'rgba(38,36,31,0.6)';
  octx.fillStyle = 'rgba(38,36,31,0.75)';
  octx.font = '9px -apple-system, sans-serif';
  for(let x = 0; x <= length; x += 10){
    const isMajor = x % 50 === 0;
    const h = isMajor ? 12 : 6;
    octx.beginPath();
    octx.moveTo(x, -16);
    octx.lineTo(x, -16 + h);
    octx.stroke();
    if(isMajor && x > 0) octx.fillText((x/PX_PER_CM).toFixed(0) + 'cm', x - 8, 6);
  }

  // the actual drawn line, centered on the strip
  octx.strokeStyle = currentColor;
  octx.lineWidth = currentSize;
  octx.lineCap = 'round';
  octx.beginPath();
  octx.moveTo(0, 0);
  octx.lineTo(length, 0);
  octx.stroke();
  octx.restore();

  showBadge(end, length.toFixed(0) + ' px  ·  ' + (length/PX_PER_CM).toFixed(1) + ' cm');
}

function drawCompassPreview(center, edge){
  const r = Math.hypot(edge.x-center.x, edge.y-center.y);
  clearOverlay();
  octx.save();
  octx.strokeStyle = 'rgba(38,36,31,0.4)';
  octx.lineWidth = 1;
  octx.setLineDash([4,4]);
  octx.beginPath();
  octx.moveTo(center.x, center.y);
  octx.lineTo(edge.x, edge.y);
  octx.stroke();
  octx.setLineDash([]);

  octx.fillStyle = currentColor;
  octx.beginPath();
  octx.arc(center.x, center.y, 3, 0, Math.PI*2);
  octx.fill();

  octx.strokeStyle = currentColor;
  octx.lineWidth = currentSize;
  octx.beginPath();
  octx.arc(center.x, center.y, r, 0, Math.PI*2);
  octx.stroke();
  octx.restore();

  showBadge(edge, 'r ' + r.toFixed(0) + ' px  ·  ' + (r/PX_PER_CM).toFixed(1) + ' cm');
}

function drawProtractorRayPreview(vertex, end){
  clearOverlay();
  octx.save();
  octx.strokeStyle = currentColor;
  octx.lineWidth = currentSize;
  octx.lineCap = 'round';
  octx.beginPath();
  octx.moveTo(vertex.x, vertex.y);
  octx.lineTo(end.x, end.y);
  octx.stroke();
  octx.restore();
  const len = Math.hypot(end.x-vertex.x, end.y-vertex.y);
  showBadge(end, len.toFixed(0) + ' px');
}
function angleBetween(vertex, a, b){
  const a1 = Math.atan2(a.y-vertex.y, a.x-vertex.x);
  const a2 = Math.atan2(b.y-vertex.y, b.x-vertex.x);
  let diff = (a2 - a1) * 180/Math.PI;
  diff = ((diff + 540) % 360) - 180;
  return diff;
}
// draws the second ray plus a tick-marked protractor arc and a live angle readout
function drawProtractorAnglePreview(vertex, ray1End, ray2End){
  clearOverlay();
  octx.save();
  octx.strokeStyle = currentColor;
  octx.lineWidth = currentSize;
  octx.lineCap = 'round';
  octx.beginPath();
  octx.moveTo(vertex.x, vertex.y);
  octx.lineTo(ray2End.x, ray2End.y);
  octx.stroke();

  const a1 = Math.atan2(ray1End.y-vertex.y, ray1End.x-vertex.x);
  const a2 = Math.atan2(ray2End.y-vertex.y, ray2End.x-vertex.x);
  const anticlockwise = a2 < a1;

  // protractor-style tick marks every 15 degrees around the arc
  octx.strokeStyle = 'rgba(38,36,31,0.5)';
  octx.lineWidth = 1;
  const step = (Math.PI/12) * (anticlockwise ? -1 : 1); // 15 degrees
  let a = a1;
  let guard = 0;
  while(guard < 30){
    const reached = anticlockwise ? (a <= a2) : (a >= a2);
    if(reached) break;
    octx.beginPath();
    octx.moveTo(vertex.x + Math.cos(a)*28, vertex.y + Math.sin(a)*28);
    octx.lineTo(vertex.x + Math.cos(a)*38, vertex.y + Math.sin(a)*38);
    octx.stroke();
    a += step;
    guard++;
  }

  octx.strokeStyle = currentColor;
  octx.lineWidth = 1.5;
  octx.beginPath();
  octx.arc(vertex.x, vertex.y, 34, a1, a2, anticlockwise);
  octx.stroke();

  const angle = Math.abs(angleBetween(vertex, ray1End, ray2End)).toFixed(0);
  const midAngle = (a1+a2)/2;
  octx.fillStyle = currentColor;
  octx.font = '13px -apple-system, sans-serif';
  octx.fillText(angle + '°', vertex.x + Math.cos(midAngle)*52 - 10, vertex.y + Math.sin(midAngle)*52);
  octx.restore();

  showBadge(ray2End, angle + '°');
}

function midpoint(a, b){ return { x: (a.x+b.x)/2, y: (a.y+b.y)/2 }; }

/* ---- pointer event handling (works for mouse, touch, and pressure-sensitive pens) ---- */
function startDraw(e){
  if(canvas.width === 0) return;
  canvas.setPointerCapture(e.pointerId);
  const pos = getPos(e);
  moveBrushCursor(pos, getPressure(e)); // show feedback the instant contact happens, even on a plain tap

  if(currentTool === 'ruler' || currentTool === 'compass'){
    drawing = true;
    shapeStart = pos;
    return;
  }

  if(currentTool === 'protractor'){
    if(protractorStage === 0){
      protractorVertex = pos;
      protractorStage = 1;
      drawing = true;
    } else if(protractorStage === 1){
      // begin dragging the second ray from the stored vertex
      drawing = true;
    }
    return;
  }

  // freehand tools
  drawing = true;
  saveSnapshot();
  lastX = pos.x; lastY = pos.y;
  smoothP0 = pos; smoothP1 = pos;
  const pressure = getPressure(e);
  applyFreehandStyle(pressure);
  ctx.beginPath();
  ctx.moveTo(lastX, lastY);
  ctx.lineTo(lastX + 0.01, lastY + 0.01);
  ctx.stroke();
  maybeExtendForPosition(pos.y);
}

function moveDraw(e){
  const pos = getPos(e);
  moveBrushCursor(pos, getPressure(e));
  if(!drawing) return;

  if(currentTool === 'ruler'){
    drawRulerPreview(shapeStart, pos);
    return;
  }
  if(currentTool === 'compass'){
    drawCompassPreview(shapeStart, pos);
    return;
  }
  if(currentTool === 'protractor'){
    if(protractorStage === 1 && protractorAngle1 === null){
      drawProtractorRayPreview(protractorVertex, pos);
    } else if(protractorStage === 1 && protractorAngle1 !== null){
      drawProtractorAnglePreview(protractorVertex, protractorAngle1, pos);
    }
    return;
  }

  // freehand — smoothed with a rolling midpoint curve so strokes feel like ink, not jagged segments
  const pressure = getPressure(e);
  applyFreehandStyle(pressure);
  const p2 = pos;
  const mid1 = midpoint(smoothP0, smoothP1);
  const mid2 = midpoint(smoothP1, p2);
  ctx.beginPath();
  ctx.moveTo(mid1.x, mid1.y);
  ctx.quadraticCurveTo(smoothP1.x, smoothP1.y, mid2.x, mid2.y);
  ctx.stroke();
  smoothP0 = smoothP1;
  smoothP1 = p2;
  lastX = p2.x; lastY = p2.y;
  maybeExtendForPosition(p2.y);
}

function endDraw(e){
  if(!drawing){ return; }
  const pos = getPos(e);
  hideBadge();

  if(currentTool === 'ruler'){
    clearOverlay();
    saveSnapshot();
    ctx.save();
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = currentSize;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(shapeStart.x, shapeStart.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    ctx.restore();
    shapeStart = null;
  } else if(currentTool === 'compass'){
    clearOverlay();
    saveSnapshot();
    const r = Math.hypot(pos.x-shapeStart.x, pos.y-shapeStart.y);
    ctx.save();
    ctx.strokeStyle = currentColor;
    ctx.lineWidth = currentSize;
    ctx.beginPath();
    ctx.arc(shapeStart.x, shapeStart.y, r, 0, Math.PI*2);
    ctx.stroke();
    ctx.restore();
    shapeStart = null;
  } else if(currentTool === 'protractor'){
    if(protractorStage === 1 && protractorAngle1 === null){
      // finished dragging the first ray — bake it and wait for the second
      clearOverlay();
      saveSnapshot();
      ctx.save();
      ctx.strokeStyle = currentColor;
      ctx.lineWidth = currentSize;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(protractorVertex.x, protractorVertex.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      ctx.restore();
      protractorAngle1 = pos;
      toolHint.textContent = "Protractor — now drag the second ray from the same point to measure the angle.";
    } else if(protractorStage === 1 && protractorAngle1 !== null){
      clearOverlay();
      saveSnapshot();
      ctx.save();
      ctx.strokeStyle = currentColor;
      ctx.lineWidth = currentSize;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(protractorVertex.x, protractorVertex.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      const a1 = Math.atan2(protractorAngle1.y-protractorVertex.y, protractorAngle1.x-protractorVertex.x);
      const a2 = Math.atan2(pos.y-protractorVertex.y, pos.x-protractorVertex.x);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(protractorVertex.x, protractorVertex.y, 34, a1, a2, a2 < a1);
      ctx.stroke();
      const angle = Math.abs(angleBetween(protractorVertex, protractorAngle1, pos)).toFixed(0);
      const midAngle = (a1+a2)/2;
      ctx.fillStyle = currentColor;
      ctx.font = '13px -apple-system, sans-serif';
      ctx.fillText(angle + '°', protractorVertex.x + Math.cos(midAngle)*52 - 10, protractorVertex.y + Math.sin(midAngle)*52);
      ctx.restore();
      resetProtractorState();
      toolHint.textContent = TOOL_HINTS.protractor;
    }
  }

  drawing = false;
  ctx.globalAlpha = 1;
}

function moveBrushCursor(pos, pressure){
  if(GEOMETRY_TOOLS.includes(currentTool)){
    brushCursor.classList.add('crosshair');
    brushCursor.style.left = pos.x + 'px';
    brushCursor.style.top = pos.y + 'px';
    brushCursor.style.opacity = 1;
    return;
  }
  brushCursor.classList.remove('crosshair');
  const base = currentTool === 'eraser' ? currentSize * 2.2 : currentSize;
  const size = widthForPressure(base, pressure || 0.5);
  brushCursor.style.width = size + 'px';
  brushCursor.style.height = size + 'px';
  brushCursor.style.left = pos.x + 'px';
  brushCursor.style.top = pos.y + 'px';
  brushCursor.style.opacity = 1;
}

canvas.addEventListener('pointerdown', startDraw);
canvas.addEventListener('pointermove', moveDraw);
canvas.addEventListener('pointerup', endDraw);
canvas.addEventListener('pointercancel', endDraw);
canvas.addEventListener('pointerleave', () => { brushCursor.style.opacity = 0; hideBadge(); });

document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTool = btn.dataset.tool;
    toolHint.textContent = TOOL_HINTS[currentTool] || '';
    clearOverlay();
    drawing = false;
    hideBadge();
    resetProtractorState();
  });
});
document.querySelectorAll('.swatch').forEach(sw => {
  sw.addEventListener('click', () => {
    document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
    sw.classList.add('active');
    currentColor = sw.dataset.color;
  });
});
document.getElementById('size-slider').addEventListener('input', (e) => {
  currentSize = parseInt(e.target.value, 10);
  document.getElementById('size-readout').textContent = currentSize + 'px';
});
document.getElementById('clear-btn').addEventListener('click', () => {
  saveSnapshot();
  ctx.clearRect(0,0,canvas.width,canvas.height);
});
document.getElementById('undo-btn').addEventListener('click', () => {
  if(strokes.length === 0) return;
  const last = strokes.pop();
  ctx.putImageData(last, 0, 0);
});

/* ================= WRITE-PANE HANDWRITING CANVAS (pressure-sensitive) ================= */
const winkCanvas = document.getElementById('write-ink-canvas');
const winkCtx = winkCanvas.getContext('2d');
const winkWrap = document.getElementById('write-ink-wrap');
const winkCursor = document.getElementById('write-brush-cursor');

let winkTool = 'pen';
let winkColor = '#26241f';
let winkSize = 3;
let winkDrawing = false;
let winkStrokes = [];
let winkIsExtending = false;
let winkSmoothP0 = null, winkSmoothP1 = null;

function loadWriteInkForPage(p){
  const wrapWidth = winkWrap.clientWidth || 800;
  const wrapHeight = winkWrap.clientHeight || 340;
  winkCanvas.width = wrapWidth;
  winkCanvas.height = Math.max((p && p.writeInkHeight) || 900, wrapHeight);
  winkCanvas.style.width = wrapWidth + 'px';
  winkCanvas.style.height = winkCanvas.height + 'px';
  winkCtx.clearRect(0, 0, winkCanvas.width, winkCanvas.height);
  if(p && p.writeInkDataURL){
    const img = new Image();
    img.onload = () => winkCtx.drawImage(img, 0, 0);
    img.src = p.writeInkDataURL;
  }
  winkWrap.scrollTop = 0;
}

function extendWriteInkDown(extra){
  if(winkIsExtending) return;
  winkIsExtending = true;
  const dataURL = winkCanvas.toDataURL();
  const oldHeight = winkCanvas.height;
  winkCanvas.height = oldHeight + extra;
  winkCanvas.style.height = winkCanvas.height + 'px';
  const img = new Image();
  img.onload = () => { winkCtx.drawImage(img, 0, 0); winkIsExtending = false; };
  img.src = dataURL;
}
winkWrap.addEventListener('scroll', () => {
  const nearBottom = (winkWrap.scrollTop + winkWrap.clientHeight) >= (winkCanvas.height - 200);
  if(nearBottom) extendWriteInkDown(600);
});

function saveWinkSnapshot(){
  if(winkCanvas.width === 0 || winkCanvas.height === 0) return;
  winkStrokes.push(winkCtx.getImageData(0,0,winkCanvas.width,winkCanvas.height));
  if(winkStrokes.length > 25) winkStrokes.shift();
}
function getWinkPos(e){
  const rect = winkCanvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}
function winkMoveCursor(pos, pressure){
  const base = winkTool === 'eraser' ? winkSize * 2.2 : winkSize;
  const size = widthForPressure(base, pressure || 0.5);
  winkCursor.style.width = size + 'px';
  winkCursor.style.height = size + 'px';
  winkCursor.style.left = pos.x + 'px';
  winkCursor.style.top = pos.y + 'px';
  winkCursor.style.opacity = 1;
}
function winkStart(e){
  if(winkCanvas.width === 0) return;
  winkCanvas.setPointerCapture(e.pointerId);
  const pos = getWinkPos(e);
  winkMoveCursor(pos, getPressure(e));
  winkDrawing = true;
  saveWinkSnapshot();
  winkSmoothP0 = pos; winkSmoothP1 = pos;
  applyFreehandStyleTo(winkCtx, winkTool, winkSize, winkColor, getPressure(e));
  winkCtx.beginPath();
  winkCtx.moveTo(pos.x, pos.y);
  winkCtx.lineTo(pos.x + 0.01, pos.y + 0.01);
  winkCtx.stroke();
  if(pos.y > winkCanvas.height - 150) extendWriteInkDown(600);
}
function winkMove(e){
  const pos = getWinkPos(e);
  winkMoveCursor(pos, getPressure(e));
  if(!winkDrawing) return;
  const pressure = getPressure(e);
  applyFreehandStyleTo(winkCtx, winkTool, winkSize, winkColor, pressure);
  const mid1 = midpoint(winkSmoothP0, winkSmoothP1);
  const mid2 = midpoint(winkSmoothP1, pos);
  winkCtx.beginPath();
  winkCtx.moveTo(mid1.x, mid1.y);
  winkCtx.quadraticCurveTo(winkSmoothP1.x, winkSmoothP1.y, mid2.x, mid2.y);
  winkCtx.stroke();
  winkSmoothP0 = winkSmoothP1;
  winkSmoothP1 = pos;
  if(pos.y > winkCanvas.height - 150) extendWriteInkDown(600);
}
function winkEnd(){ winkDrawing = false; winkCtx.globalAlpha = 1; }

winkCanvas.addEventListener('pointerdown', winkStart);
winkCanvas.addEventListener('pointermove', winkMove);
winkCanvas.addEventListener('pointerup', winkEnd);
winkCanvas.addEventListener('pointercancel', winkEnd);
winkCanvas.addEventListener('pointerleave', () => { winkCursor.style.opacity = 0; });

document.querySelectorAll('[data-wtool]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-wtool]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    winkTool = btn.dataset.wtool;
  });
});
document.querySelectorAll('[data-wcolor]').forEach(sw => {
  sw.addEventListener('click', () => {
    document.querySelectorAll('[data-wcolor]').forEach(s => s.classList.remove('active'));
    sw.classList.add('active');
    winkColor = sw.dataset.wcolor;
  });
});
document.getElementById('write-size-slider').addEventListener('input', (e) => {
  winkSize = parseInt(e.target.value, 10);
  document.getElementById('write-size-readout').textContent = winkSize + 'px';
});
document.getElementById('write-clear-btn').addEventListener('click', () => {
  saveWinkSnapshot();
  winkCtx.clearRect(0,0,winkCanvas.width,winkCanvas.height);
});
document.getElementById('write-undo-btn').addEventListener('click', () => {
  if(winkStrokes.length === 0) return;
  const last = winkStrokes.pop();
  winkCtx.putImageData(last, 0, 0);
});
window.addEventListener('resize', () => {
  if(document.getElementById('write-pane').classList.contains('active')){
    const dataURL = winkCanvas.width ? winkCanvas.toDataURL() : null;
    const wrapWidth = winkWrap.clientWidth || 800;
    winkCanvas.width = wrapWidth;
    winkCanvas.style.width = wrapWidth + 'px';
    if(dataURL){
      const img = new Image();
      img.onload = () => winkCtx.drawImage(img, 0, 0);
      img.src = dataURL;
    }
  }
});

/* ================= FLOATING CALCULATOR (shared factory — used in both Draw and Write) ================= */
function evaluateExpression(input){
  let str = input.replace(/π/g, 'pi').replace(/×/g,'*').replace(/÷/g,'/').replace(/\s+/g,'');
  let i = 0;
  function peek(){ return str[i]; }
  function consume(){ return str[i++]; }
  function parseExpr(){
    let value = parseTerm();
    while(peek() === '+' || peek() === '-'){
      const op = consume();
      const rhs = parseTerm();
      value = op === '+' ? value + rhs : value - rhs;
    }
    return value;
  }
  function parseTerm(){
    let value = parseFactor();
    while(peek() === '*' || peek() === '/' || peek() === '%'){
      const op = consume();
      const rhs = parseFactor();
      if(op === '*') value = value * rhs;
      else if(op === '/') value = value / rhs;
      else value = value % rhs;
    }
    return value;
  }
  function parseFactor(){
    let value = parseUnary();
    while(peek() === '^'){
      consume();
      const rhs = parseUnary();
      value = Math.pow(value, rhs);
    }
    return value;
  }
  function parseUnary(){
    if(peek() === '-'){ consume(); return -parseUnary(); }
    if(peek() === '+'){ consume(); return parseUnary(); }
    return parsePrimary();
  }
  function parseFunc(name){
    consume();
    const arg = parseExpr();
    if(peek() === ')') consume();
    switch(name){
      case 'sqrt': return Math.sqrt(arg);
      case 'sin': return Math.sin(arg);
      case 'cos': return Math.cos(arg);
      case 'tan': return Math.tan(arg);
      case 'log': return Math.log10(arg);
      case 'ln': return Math.log(arg);
      case 'abs': return Math.abs(arg);
      default: throw new Error('Unknown function: ' + name);
    }
  }
  function parsePrimary(){
    if(peek() === '('){
      consume();
      const value = parseExpr();
      if(peek() === ')') consume();
      return value;
    }
    const funcMatch = /^(sqrt|sin|cos|tan|log|ln|abs)/.exec(str.slice(i));
    if(funcMatch){ i += funcMatch[0].length; return parseFunc(funcMatch[0]); }
    if(str.slice(i,i+2) === 'pi'){ i += 2; return Math.PI; }
    if(peek() === 'e' && !/^[a-zA-Z]/.test(str[i+1] || '')){ consume(); return Math.E; }
    const numMatch = /^\d+(\.\d+)?/.exec(str.slice(i));
    if(numMatch){ i += numMatch[0].length; return parseFloat(numMatch[0]); }
    throw new Error('Unexpected character: ' + peek());
  }
  if(!str) return 0;
  const result = parseExpr();
  if(i < str.length) throw new Error('Unexpected trailing input');
  return result;
}

function setupCalculator(ids){
  const panel = document.getElementById(ids.panel);
  const toggleBtn = ids.toggle ? document.getElementById(ids.toggle) : null;
  const closeBtn = document.getElementById(ids.close);
  const display = document.getElementById(ids.display);
  const result = document.getElementById(ids.result);
  const grid = document.getElementById(ids.grid);
  const insertBtn = document.getElementById(ids.insert);

  if(toggleBtn) toggleBtn.addEventListener('click', () => panel.classList.toggle('open'));
  closeBtn.addEventListener('click', () => panel.classList.remove('open'));

  const keys = ['7','8','9','÷','4','5','6','×','1','2','3','−','0','.','(',')','C','⌫','^','+','sqrt','sin','cos','='];
  keys.forEach(k => {
    const btn = document.createElement('button');
    btn.className = 'calc-key' + (['÷','×','−','+','^'].includes(k) ? ' op' : '') + (k === '=' ? ' eq' : '');
    btn.textContent = k;
    btn.addEventListener('click', () => handleKey(k));
    grid.appendChild(btn);
  });
  function handleKey(k){
    if(k === 'C'){ display.value = '0'; result.textContent = '\u00A0'; return; }
    if(k === '⌫'){ display.value = display.value.slice(0,-1) || '0'; return; }
    if(k === '='){
      try{
        const r = evaluateExpression(display.value);
        result.textContent = '= ' + r;
      } catch(err){
        result.textContent = 'Check the expression';
      }
      return;
    }
    if(k === 'sqrt' || k === 'sin' || k === 'cos'){
      display.value = (display.value === '0' ? '' : display.value) + k + '(';
      return;
    }
    const insertChar = k === '−' ? '-' : k;
    display.value = (display.value === '0' ? '' : display.value) + insertChar;
  }
  display.addEventListener('keydown', (e) => { if(e.key === 'Enter') handleKey('='); });
  insertBtn.addEventListener('click', () => {
    const line = display.value + ' ' + (result.textContent.startsWith('=') ? result.textContent : '');
    const textarea = document.getElementById('text-area');
    const needsNewline = textarea.value.length > 0 && !textarea.value.endsWith('\n');
    textarea.value += (needsNewline ? '\n' : '') + line.trim() + '\n';
    autoGrowTextarea();
  });
}

setupCalculator({ panel: 'calc-panel', toggle: 'calc-toggle', close: 'calc-close', display: 'calc-display', result: 'calc-result', grid: 'calc-grid', insert: 'calc-insert' });
setupCalculator({ panel: 'calc-panel-write', toggle: 'calc-toggle-write', close: 'calc-close-write', display: 'calc-display-write', result: 'calc-result-write', grid: 'calc-grid-write', insert: 'calc-insert-write' });

/* ================= SYMBOL PALETTE (right in the Write toolbar) ================= */
const symbols = ['√','π','∑','∫','±','÷','×','∞','θ','Δ','≤','≥','≈','²','³','^','·','∂','∅','∈'];
const symbolGridWrite = document.getElementById('symbol-grid-write');
symbols.forEach(sym => {
  const btn = document.createElement('button');
  btn.className = 'symbol-btn';
  btn.textContent = sym;
  btn.addEventListener('click', () => insertAtCursor(sym));
  symbolGridWrite.appendChild(btn);
});

/* ================= EXPORT / IMPORT ALL PAGES ================= */
document.getElementById('export-btn').addEventListener('click', () => {
  saveActivePageState();
  const data = { pages: pages.map(p => ({ name: p.name, text: p.text, canvasDataURL: p.canvasDataURL, canvasHeight: p.canvasHeight, writeInkDataURL: p.writeInkDataURL, writeInkHeight: p.writeInkHeight })) };
  const blob = new Blob([JSON.stringify(data)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'notepad-backup.json';
  a.click();
});
document.getElementById('import-btn').addEventListener('click', () => {
  document.getElementById('import-input').click();
});
document.getElementById('import-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const data = JSON.parse(reader.result);
      if(!data.pages || !Array.isArray(data.pages) || data.pages.length === 0) throw new Error('bad file');
      pages = data.pages.map(p => ({ id: pageIdCounter++, name: p.name || ('Page ' + pageIdCounter), text: p.text || '', canvasDataURL: p.canvasDataURL || null, canvasHeight: p.canvasHeight || 1400, writeInkDataURL: p.writeInkDataURL || null, writeInkHeight: p.writeInkHeight || 900 }));
      activePageId = pages[0].id;
      loadActivePageIntoUI();
      renderPageList();
    } catch(err){
      alert('That file could not be read as a notepad backup.');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
});

/* ================= DOWNLOAD CURRENT PAGE ================= */
document.getElementById('download-btn').addEventListener('click', () => {
  const activePane = document.querySelector('#write-pane.active, #draw-pane.active');
  const paneId = activePane ? activePane.id : 'write-pane';
  if(paneId === 'draw-pane'){
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = (getActivePage().name || 'drawing') + '.png';
    a.click();
  } else {
    const text = document.getElementById('text-area').value;
    const blob = new Blob([text], {type:'text/plain'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (getActivePage().name || 'notes') + '.txt';
    a.click();
  }
});

/* ================= INIT ================= */
renderPageList();