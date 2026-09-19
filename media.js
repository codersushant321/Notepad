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