export function setupReadingPreferences() {
  const workspace = document.querySelector<HTMLElement>('.workspace')!;
  const handle = document.querySelector<HTMLElement>('#panel-divider')!;
  const dictionary = document.querySelector<HTMLElement>('.dictionary')!;
  let preferredWidth = 400;
  let fontSize = 16;
  try {
    preferredWidth = Number(localStorage.getItem('leaf-dictionary-width')) || 400;
    fontSize = Number(localStorage.getItem('leaf-dictionary-font-size')) || 16;
  } catch {}
  function store(key: string, value: number) { try { localStorage.setItem(key, String(value)); } catch {} }
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

  const cursor = document.createElement('div');
  cursor.id = 'leaf-cursor';
  cursor.setAttribute('aria-hidden', 'true');
  document.body.append(cursor);
  const hideCursor = () => { cursor.classList.remove('visible', 'active'); document.documentElement.classList.remove('leaf-pointer-active'); };
  document.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse' || !matchMedia('(any-pointer: fine)').matches) { hideCursor(); return; }
    // A modal dialog is in the browser's top layer; keep the single ring in that layer too.
    const modal = document.querySelector<HTMLElement>('dialog[open]');
    const parent = modal || document.body;
    if (cursor.parentElement !== parent) parent.append(cursor);
    const bounds = modal?.getBoundingClientRect();
    cursor.style.setProperty('--cx', event.clientX - (bounds?.left || 0) + (modal?.scrollLeft || 0) + 'px');
    cursor.style.setProperty('--cy', event.clientY - (bounds?.top || 0) + (modal?.scrollTop || 0) + 'px');
    cursor.classList.add('visible');
    document.documentElement.classList.add('leaf-pointer-active');
  }, { passive: true });
  document.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch') return;
    cursor.classList.add('active');
  }, { passive: true });
  const release = () => cursor.classList.remove('active');
  document.addEventListener('pointerup', release, { passive: true });
  document.addEventListener('pointercancel', release, { passive: true });
  document.addEventListener('mouseleave', hideCursor);
  window.addEventListener('blur', hideCursor);
  document.addEventListener('visibilitychange', () => { if (document.hidden) hideCursor(); });
  document.addEventListener('close', hideCursor, true);
}
