export function setupReadingPreferences() {
  const workspace = document.querySelector<HTMLElement>('.workspace')!;
  const handle = document.querySelector<HTMLElement>('#panel-divider')!;
  const dictionary = document.querySelector<HTMLElement>('.dictionary')!;
  let preferredWidth = 400;
  let fontSize = 18;
  try {
    preferredWidth = Number(localStorage.getItem('leaf-dictionary-width')) || 400;
    fontSize = Number(localStorage.getItem('leaf-dictionary-font-size')) || 18;
  } catch {}
  function store(key: string, value: number) { try { localStorage.setItem(key, String(value)); } catch {} }
  const uiFont = document.querySelector<HTMLSelectElement>('#ui-font-size')!;
  try { const saved = localStorage.getItem('leaf-ui-font-size'); if (saved && ['16', '18', '20'].includes(saved)) uiFont.value = saved; } catch {}
  const applyUiFont = () => { document.documentElement.style.fontSize = uiFont.value + 'px'; store('leaf-ui-font-size', Number(uiFont.value)); };
  uiFont.onchange = applyUiFont;
  applyUiFont();
  function limits() { return { min: 280, max: Math.max(280, Math.min(720, workspace.clientWidth - 340)) }; }
  function resize(width: number, remember = false) {
    if (!workspace.clientWidth) return;
    const { min, max } = limits();
    const value = Math.max(min, Math.min(max, width));
    workspace.style.setProperty('--dictionary-width', value + 'px');
    handle.setAttribute('aria-valuemin', String(min));
    handle.setAttribute('aria-valuemax', String(max));
    handle.setAttribute('aria-valuenow', String(Math.round(value)));
    handle.setAttribute('aria-valuetext', '사전 너비 ' + Math.round(value) + '픽셀');
    if (remember) { preferredWidth = value; store('leaf-dictionary-width', value); }
  }
  function applyFont() {
    fontSize = Math.max(14, Math.min(22, fontSize));
    dictionary.style.setProperty('--dictionary-font-size', fontSize + 'px');
    document.querySelector('#dictionary-font-size')!.textContent = fontSize + 'px';
    document.querySelector<HTMLButtonElement>('#dictionary-font-down')!.disabled = fontSize === 14;
    document.querySelector<HTMLButtonElement>('#dictionary-font-up')!.disabled = fontSize === 22;
    store('leaf-dictionary-font-size', fontSize);
  }
  document.querySelector<HTMLButtonElement>('#dictionary-font-down')!.onclick = () => { fontSize--; applyFont(); };
  document.querySelector<HTMLButtonElement>('#dictionary-font-up')!.onclick = () => { fontSize++; applyFont(); };
  handle.onpointerdown = event => {
    if (event.button !== 0) return;
    event.preventDefault(); handle.setPointerCapture(event.pointerId);
    document.body.classList.add('resizing-panels');
  };
  handle.onpointermove = event => {
    if (handle.hasPointerCapture(event.pointerId)) resize(workspace.getBoundingClientRect().right - event.clientX - 4, true);
  };
  const stop = () => document.body.classList.remove('resizing-panels');
  handle.onpointerup = event => { if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId); stop(); };
  handle.onlostpointercapture = stop;
  handle.onpointercancel = stop;
  handle.onkeydown = event => {
    const width = Number(handle.getAttribute('aria-valuenow'));
    const { min, max } = limits();
    const next = ({ ArrowLeft: width + 20, ArrowRight: width - 20, Home: min, End: max } as Record<string, number>)[event.key];
    if (next !== undefined) { event.preventDefault(); resize(next, true); }
  };
  handle.ondblclick = () => resize(400, true);
  new ResizeObserver(() => resize(preferredWidth)).observe(workspace);
  resize(preferredWidth); applyFont();

  const clickEffect = document.querySelector<HTMLInputElement>('#click-effect-toggle')!;
  try { clickEffect.checked = localStorage.getItem('leaf-click-effect') !== 'off'; } catch {}
  let ring: HTMLDivElement | undefined;
  let ringTimer = 0;
  const clearRing = () => { clearTimeout(ringTimer); ring?.remove(); ring = undefined; };
  clickEffect.onchange = () => {
    clearRing();
    try { localStorage.setItem('leaf-click-effect', clickEffect.checked ? 'on' : 'off'); } catch {}
  };
  // Leave movement, cursor shape and speed entirely to the OS/browser.
  document.addEventListener('pointerdown', event => {
    if (!clickEffect.checked || event.pointerType !== 'mouse' || event.button !== 0
      || (event.target as Element).closest('.click-effect-option')) return;
    clearRing();
    ring = document.createElement('div');
    ring.id = 'leaf-click-effect'; ring.setAttribute('aria-hidden', 'true');
    const modal = document.querySelector<HTMLElement>('dialog[open]');
    const bounds = modal?.getBoundingClientRect();
    ring.style.left = event.clientX - (bounds?.left || 0) - (modal?.clientLeft || 0) + (modal?.scrollLeft || 0) + 'px';
    ring.style.top = event.clientY - (bounds?.top || 0) - (modal?.clientTop || 0) + (modal?.scrollTop || 0) + 'px';
    (modal || document.body).append(ring);
    ringTimer = window.setTimeout(clearRing, 400);
  }, { passive: true });
  document.addEventListener('pointercancel', clearRing, { passive: true });
  document.addEventListener('mouseleave', clearRing);
  window.addEventListener('blur', clearRing);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearRing(); });
  document.addEventListener('close', clearRing, true);
}
