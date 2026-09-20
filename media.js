/* ============================================================
   MOBILE ADDITIONS - add before </body> (after your main script)
   Assumes ids: #draw-pane, #write-pane, #write-ink-wrap, #write-toolbar,
   and a .dock element inside #draw-pane.
   ============================================================ */
(function(){
  const drawPane  = document.getElementById('draw-pane');
  const writePane = document.getElementById('write-pane');
  const inkWrap   = document.getElementById('write-ink-wrap');
  const toolbar   = document.getElementById('write-toolbar');
  const dock      = drawPane && drawPane.querySelector('.dock');

  // Safe storage (some embeds block localStorage)
  const store = {
    get(k){ try { return localStorage.getItem(k); } catch(e){ return null; } },
    set(k,v){ try { localStorage.setItem(k,v); } catch(e){} }
  };

  /* ---------- DOCK: flip side + collapse ---------- */
  if (drawPane && dock){
    // Flip button lives inside the dock
    const flip = document.createElement('button');
    flip.className = 'tool-btn';
    flip.title = 'Move toolbar to other side';
    flip.textContent = '⇆';
    const group = document.createElement('div');
    group.className = 'dock-group dock-controls';
    group.appendChild(flip);
    dock.insertBefore(group, dock.firstChild);

    // Edge handle: collapse / expand
    const handle = document.createElement('button');
    handle.className = 'dock-toggle';
    handle.title = 'Show / hide toolbar';
    drawPane.appendChild(handle);

    function refresh(){
      const right = drawPane.classList.contains('dock-right');
      const collapsed = drawPane.classList.contains('dock-collapsed');
      // arrow points in the direction the dock will move
      handle.textContent = (right ? !collapsed : collapsed) ? '‹' : '›';
    }

    if (store.get('dockRight') === '1')     drawPane.classList.add('dock-right');
    if (store.get('dockCollapsed') === '1') drawPane.classList.add('dock-collapsed');
    refresh();

    flip.addEventListener('click', () => {
      const on = drawPane.classList.toggle('dock-right');
      store.set('dockRight', on ? '1' : '0');
      refresh();
    });
    handle.addEventListener('click', () => {
      const on = drawPane.classList.toggle('dock-collapsed');
      store.set('dockCollapsed', on ? '1' : '0');
      refresh();
      // Canvas area changed width; let your canvas code resize if it listens
      window.dispatchEvent(new Event('resize'));
    });
  }

  /* ---------- WRITE: fullscreen + scroll/draw mode ---------- */
  if (writePane && toolbar){
    const grp = document.createElement('div');
    grp.className = 'toolbar-group';

    const fsBtn = document.createElement('button');
    fsBtn.id = 'fullscreen-btn';
    fsBtn.className = 'btn';
    fsBtn.textContent = '⛶ Full screen';

    const modeBtn = document.createElement('button');
    modeBtn.className = 'btn';
    modeBtn.title = 'Toggle: fingers scroll the ink area, or draw on it';
    modeBtn.textContent = '✋ Scroll';

    grp.append(modeBtn, fsBtn);
    toolbar.appendChild(grp);

    // Fullscreen: CSS class always; native Fullscreen API when available
    function setFullscreen(on){
      writePane.classList.toggle('fullscreen', on);
      document.body.classList.toggle('write-fullscreen', on);
      fsBtn.textContent = on ? '✕ Exit full screen' : '⛶ Full screen';
      const el = document.documentElement;
      try {
        if (on && el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().catch(()=>{});
        if (!on && document.fullscreenElement) document.exitFullscreen().catch(()=>{});
      } catch(e){}
      window.dispatchEvent(new Event('resize'));
    }
    fsBtn.addEventListener('click', () => setFullscreen(!writePane.classList.contains('fullscreen')));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && writePane.classList.contains('fullscreen')) setFullscreen(false);
    });
    // If user exits native fullscreen via system gesture, sync the class
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement && writePane.classList.contains('fullscreen')) setFullscreen(false);
    });

    // Scroll mode: touch pans the ink area (CSS sets touch-action)
    modeBtn.addEventListener('click', () => {
      const scrolling = inkWrap.classList.toggle('scroll-mode');
      modeBtn.textContent = scrolling ? '✏️ Draw' : '✋ Scroll';
    });
  }

  /* ---------- Optional: pen draws, finger scrolls ----------
     In your ink canvas pointerdown handler add:
       if (e.pointerType === 'touch' && inkWrap.classList.contains('scroll-mode')) return;
     so finger touches fall through to native scrolling while a stylus still draws. */
})();
     4. Slim draggable scrollbar on the Write pane, ink area and Draw canvas
   ============================================================ */
(function(){
  const $ = id => document.getElementById(id);
  const store = {
    get(k){ try { return localStorage.getItem(k); } catch(e){ return null; } },
    set(k,v){ try { localStorage.setItem(k,v); } catch(e){} }
  };

  /* ==========================================================
     1. TOP BAR  (full / compact / hidden)
     ========================================================== */
  const header = document.querySelector('header');
  if (header){
    const left = header.querySelector('.header-left') || header;
    const btn = document.createElement('button');
    btn.className = 'bar-toggle';
    left.appendChild(btn);

    const reveal = document.createElement('button');
    reveal.id = 'bar-reveal';
    reveal.textContent = '▾ Menu';
    document.body.appendChild(reveal);

    const order = ['full', 'compact', 'hidden'];
    const isPhone = window.matchMedia('(max-width: 720px)').matches;
    let state = store.get('barState') || (isPhone ? 'compact' : 'full');
    if (!order.includes(state)) state = 'full';

    function apply(){
      header.classList.toggle('compact', state === 'compact');
      header.classList.toggle('bar-hidden', state === 'hidden');
      reveal.classList.toggle('show', state === 'hidden');
      btn.textContent = state === 'full' ? '▴' : '▾';
      btn.title = 'Top bar: ' + state + ' (tap to change)';
      store.set('barState', state);
      window.dispatchEvent(new Event('resize'));   // canvases can re-measure
    }
    btn.addEventListener('click', () => {
      state = order[(order.indexOf(state) + 1) % order.length];
      apply();
    });
    reveal.addEventListener('click', () => { state = 'compact'; apply(); });
    apply();
  }

  /* ==========================================================
     2. SEPARATE PEN / ERASER SIZES
     ========================================================== */
  const num = (v, d) => { const n = parseInt(v, 10); return isNaN(n) ? d : n; };
  const sizes = window.brushSizes = {
    pen:    num(store.get('penSize'),    4),
    eraser: num(store.get('eraserSize'), 18)
  };
  window.getToolSize = tool => sizes[tool === 'eraser' ? 'eraser' : 'pen'];

  const sliders = { pen: [], eraser: [] };     // every slider bound to each size

  function setSize(tool, value, source){
    value = num(value, sizes[tool]);
    sizes[tool] = value;
    store.set(tool === 'eraser' ? 'eraserSize' : 'penSize', String(value));
    sliders[tool].forEach(s => {
      if (s.input !== source) s.input.value = value;
      if (s.readout) s.readout.textContent = value + 'px';
    });
    document.dispatchEvent(new CustomEvent('brushsizechange', { detail: { tool, size: value } }));
  }

  function bind(tool, input, readout, min, max){
    if (!input) return;
    input.min = min; input.max = max; input.step = 1;
    input.value = sizes[tool];
    // Replace the element to drop any older listeners that shared one size
    const clone = input.cloneNode(true);
    input.replaceWith(clone);
    const entry = { input: clone, readout };
    sliders[tool].push(entry);
    if (readout) readout.textContent = sizes[tool] + 'px';
    clone.addEventListener('input', () => setSize(tool, clone.value, clone));
  }

  // --- Draw dock ---
  const dock = document.querySelector('#draw-pane .dock');
  bind('pen', $('size-slider'), $('size-readout'), 1, 40);

  let eraserSlider = $('eraser-size-slider');
  if (!eraserSlider && dock){
    const g = document.createElement('div');
    g.className = 'dock-group';
    g.innerHTML =
      '<span class="dock-label">Eraser</span>' +
      '<input id="eraser-size-slider" type="range">' +
      '<span id="eraser-size-readout"></span>';
    dock.appendChild(g);
  }
  bind('eraser', $('eraser-size-slider'), $('eraser-size-readout'), 4, 120);

  // --- Write ink toolbar ---
  const writePen = $('write-size-slider');
  const inkBar = $('write-ink-toolbar');
  if (writePen && inkBar){
    const penReadout = $('write-size-readout');
    // Wrap the existing pen slider with a label
    const penField = document.createElement('label');
    penField.className = 'size-field pen';
    penField.append('Pen');
    writePen.replaceWith(penField);
    penField.appendChild(writePen);
    if (penReadout){ penReadout.classList.add('readout'); penField.appendChild(penReadout); }
    bind('pen', writePen, penReadout, 1, 40);

    // Separate eraser slider next to it
    const eraserField = document.createElement('label');
    eraserField.className = 'size-field eraser';
    eraserField.innerHTML = 'Eraser <input id="write-eraser-size-slider" type="range"><span class="readout" id="write-eraser-size-readout"></span>';
    penField.after(eraserField);
    bind('eraser', $('write-eraser-size-slider'), $('write-eraser-size-readout'), 4, 120);
  }

  /* ==========================================================
     3. TWO-FINGER PAN  (one finger draws, two fingers scroll)
     ========================================================== */
  function enableTwoFingerPan(canvas, scroller, chainTo){
    if (!canvas || !scroller) return;
    const pts = new Map();
    let panning = false, last = null;

    const mid = () => {
      const [a, b] = [...pts.values()];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };

    canvas.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch' || !e.isTrusted) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size >= 2){
        e.stopImmediatePropagation(); e.preventDefault();
        if (!panning){
          panning = true;
          window.__twoFingerPan = true;
          // Tell the drawing code to abandon the stroke the first finger started
          pts.forEach((_, id) => {
            if (id !== e.pointerId){
              canvas.dispatchEvent(new PointerEvent('pointercancel',
                { pointerId: id, pointerType: 'touch', bubbles: true }));
            }
          });
          last = mid();
        }
      }
    }, true);

    canvas.addEventListener('pointermove', e => {
      if (e.pointerType !== 'touch' || !e.isTrusted || !pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!panning) return;
      e.stopImmediatePropagation(); e.preventDefault();
      if (pts.size < 2) return;
      const m = mid();
      const dx = last.x - m.x, dy = last.y - m.y;
      last = m;
      const before = scroller.scrollTop;
      scroller.scrollLeft += dx;
      scroller.scrollTop  += dy;
      const leftover = dy - (scroller.scrollTop - before);
      if (chainTo && Math.abs(leftover) > 0.5) chainTo.scrollTop += leftover;  // hand off at the edge
    }, true);

    const end = e => {
      if (e.pointerType !== 'touch' || !e.isTrusted) return;
      const was = pts.delete(e.pointerId);
      if (panning && was){
        e.stopImmediatePropagation();
        if (pts.size === 0){ panning = false; window.__twoFingerPan = false; }
      }
    };
    canvas.addEventListener('pointerup', end, true);
    canvas.addEventListener('pointercancel', end, true);
  }

  enableTwoFingerPan($('write-ink-canvas'), $('write-ink-wrap'), $('write-pane'));
  enableTwoFingerPan($('draw-canvas'), $('canvas-wrap'), null);

  /* ==========================================================
     4. SLIM SCROLLBAR
     ========================================================== */
  function slimScrollbar(scroller){
    if (!scroller) return;
    scroller.classList.add('has-slim');

    const bar = document.createElement('div');
    bar.className = 'slim-scroll';
    bar.innerHTML = '<div class="track"></div><div class="thumb"></div>';
    document.body.appendChild(bar);
    const thumb = bar.querySelector('.thumb');
    let fade;

    function update(){
      const shown = scroller.getClientRects().length > 0;       // false if display:none
      const ch = scroller.clientHeight, sh = scroller.scrollHeight;
      if (!shown || sh <= ch + 1){ bar.classList.remove('on'); return; }
      const r = scroller.getBoundingClientRect();
      bar.style.left   = (r.right - bar.offsetWidth - 2) + 'px';
      bar.style.top    = (r.top + 4) + 'px';
      bar.style.height = Math.max(0, r.height - 8) + 'px';
      bar.classList.add('on');
      const H  = bar.clientHeight;
      const th = Math.max(36, H * ch / sh);
      const p  = scroller.scrollTop / (sh - ch);
      thumb.style.height = th + 'px';
      thumb.style.top    = ((H - th) * p) + 'px';
    }
    const flash = () => {
      bar.classList.add('active');
      clearTimeout(fade);
      fade = setTimeout(() => bar.classList.remove('active'), 900);
    };

    scroller.addEventListener('scroll', () => { update(); flash(); }, { passive: true });
    window.addEventListener('resize', update);
    if (window.ResizeObserver){
      const ro = new ResizeObserver(update);
      ro.observe(scroller);
      [...scroller.children].forEach(c => ro.observe(c));
    }
    document.addEventListener('click', () => setTimeout(update, 60));   // tabs, pages, fullscreen
    document.addEventListener('input', update);
    setInterval(update, 700);                                           // safety net
    update();

    // Drag / tap-to-jump
    let grab = 0;
    function setFromY(y){
      const br = bar.getBoundingClientRect();
      const th = thumb.offsetHeight;
      const p  = Math.min(1, Math.max(0, (y - br.top - grab) / Math.max(1, br.height - th)));
      scroller.scrollTop = p * (scroller.scrollHeight - scroller.clientHeight);
    }
    bar.addEventListener('pointerdown', e => {
      e.preventDefault();
      bar.setPointerCapture(e.pointerId);
      bar.classList.add('dragging');
      const tr = thumb.getBoundingClientRect();
      grab = (e.clientY >= tr.top && e.clientY <= tr.bottom) ? e.clientY - tr.top : tr.height / 2;
      setFromY(e.clientY);
    });
    bar.addEventListener('pointermove', e => {
      if (bar.hasPointerCapture(e.pointerId)) setFromY(e.clientY);
    });
    const stop = e => {
      bar.classList.remove('dragging');
      try { bar.releasePointerCapture(e.pointerId); } catch(_){}
    };
    bar.addEventListener('pointerup', stop);
    bar.addEventListener('pointercancel', stop);
  }

  slimScrollbar($('write-pane'));
  slimScrollbar($('write-ink-wrap'));
  slimScrollbar($('canvas-wrap'));

  /* ==========================================================
     HOOK UP YOUR DRAWING CODE (two small edits):
     a) Wherever you read the brush size, use the tool-specific one:
          const size = getToolSize(currentTool);   // 'pen' or 'eraser'
        and remove any old handler that writes one shared size variable.
        To resize your custom cursor live:
          document.addEventListener('brushsizechange', e => { ... e.detail.tool / .size ... });
     b) In your canvas pointerdown/move/up handlers, ignore input while
        two fingers are panning:
          if (window.__twoFingerPan) return;
        and (if you have one) end the current stroke on 'pointercancel'.
     ========================================================== */
})();
