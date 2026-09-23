// Non-modal viewers, shared open/close, keyboard focus and pointer positioning.
(() => {
  const workspace = document.getElementById('debug-workspace');
  if (!workspace) return;
  const panels = [...workspace.querySelectorAll('.debug-panel')];
  const triggers = [...document.querySelectorAll('[data-open-panel]')];
  let lastTrigger = null;
  let topLayer = 1;
  const sync = () => {
    workspace.hidden = panels.every(panel => panel.hidden);
    triggers.forEach(button => {
      const target = button.dataset.openPanel;
      button.setAttribute('aria-expanded', String(target === 'both' ? panels.every(panel => !panel.hidden) : !document.getElementById(`panel-${target}`).hidden));
    });
    window.dispatchEvent(new CustomEvent('viewer-visibility', {detail:{visible:!workspace.hidden}}));
  };
  const resetPositions = () => panels.forEach(panel => { panel.style.transform = ''; panel.dataset.x = '0'; panel.dataset.y = '0'; });
  document.querySelectorAll('[data-panel-resize]').forEach(button => button.addEventListener('click', () => {
    const name = button.dataset.panelResize;
    const panel = document.getElementById(`panel-${name}`);
    const width = Math.max(220, Math.min(500, Number(panel.dataset.width || 300) + Number(button.dataset.step)));
    panel.dataset.width = String(width);
    panel.style.setProperty('--panel-width', `${width}px`);
    document.querySelector(`[data-panel-width="${name}"]`).textContent = width;
    document.querySelectorAll(`[data-panel-resize="${name}"]`).forEach(control => {
      control.disabled = Number(control.dataset.step) < 0 ? width === 220 : width === 500;
    });
    resetPositions();
    panel.dispatchEvent(new Event('viewerresize'));
  }));
  const open = (name, trigger, focus = true) => {
    lastTrigger = trigger || lastTrigger;
    workspace.hidden = false;
    panels.forEach(panel => { if (name === 'both' || panel.id === `panel-${name}`) panel.hidden = false; });
    sync();
    const panel = name === 'both' ? panels[0] : document.getElementById(`panel-${name}`);
    panel.style.zIndex = String(++topLayer);
    if (!focus) return;
    panel.focus({preventScroll: true});
    const rect = panel.getBoundingClientRect();
    if (rect.left < 0 || rect.right > innerWidth) panel.scrollIntoView({block: 'nearest', inline: 'nearest'});
  };
  const close = panel => {
    panel.hidden = true;
    sync();
    if (workspace.hidden) lastTrigger?.focus();
    else panels.find(item => !item.hidden)?.focus({preventScroll: true});
  };
  triggers.forEach(button => {
    button.setAttribute('aria-controls', button.dataset.openPanel === 'both' ? 'panel-screenshot panel-nodes' : `panel-${button.dataset.openPanel}`);
    button.addEventListener('click', () => open(button.dataset.openPanel, button));
  });
  window.addEventListener('viewer-open', () => open('both', null, false));
  document.querySelectorAll('[data-close-panel]').forEach(button => button.addEventListener('click', () => close(document.getElementById(`panel-${button.dataset.closePanel}`))));
  document.querySelectorAll('[data-close-all-panels]').forEach(button => button.addEventListener('click', () => { panels.forEach(panel => { panel.hidden = true; }); sync(); button.focus(); }));
  document.querySelectorAll('[data-reset-panels]').forEach(button => button.addEventListener('click', resetPositions));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !workspace.hidden) {
      const panel = [...panels].filter(item => !item.hidden).sort((a,b) => Number(b.style.zIndex || 0) - Number(a.style.zIndex || 0))[0];
      close(panel); event.preventDefault();
    }
  });
  panels.forEach(panel => {
    panel.addEventListener('pointerdown', () => { panel.style.zIndex = String(++topLayer); });
    const handle = panel.querySelector('.panel-handle');
    let drag = null;
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('button,a,input')) return;
      const rect = panel.getBoundingClientRect();
      // Keep positions in the desktop canvas, including when the page is horizontally scrolled.
      drag = {id: event.pointerId, pointerX: event.pageX, pointerY: event.pageY,
        x: Number(panel.dataset.x || 0), y: Number(panel.dataset.y || 0),
        left: rect.left + scrollX, right: rect.right + scrollX, top: rect.top + scrollY,
        canvasWidth: document.body.clientWidth, canvasHeight: Math.max(innerHeight, document.body.clientHeight)};
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    handle.addEventListener('pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = Math.max(8 - drag.left, Math.min(drag.canvasWidth - 8 - drag.right, event.pageX - drag.pointerX));
      const dy = Math.max(44 - drag.top, Math.min(drag.canvasHeight - 60 - drag.top, event.pageY - drag.pointerY));
      panel.dataset.x = String(drag.x + dx); panel.dataset.y = String(drag.y + dy);
      panel.style.transform = `translate(${panel.dataset.x}px,${panel.dataset.y}px)`;
    });
    handle.addEventListener('pointerup', () => { drag = null; });
    handle.addEventListener('pointercancel', () => { drag = null; });
    handle.addEventListener('lostpointercapture', () => { drag = null; });
  });
  window.addEventListener('resize', resetPositions);
  sync();
  if (location.hash === '#inspect') open('both');
})();
