// Keep native selection while dragging; only complete partial words on release.
export function setupSelectionFeedback(pages: HTMLElement, tools: HTMLElement, capture: () => void) {
  const preview = document.createElement('div'); preview.id = 'selection-preview';
  const toggle = document.createElement('button'); toggle.id = 'selection-snap'; toggle.type = 'button'; toggle.className = 'text-button'; toggle.hidden = true;
  tools.prepend(preview, toggle);
  const live = document.createElement('div'); live.id = 'selection-live'; live.hidden = true; document.body.append(live);
  let start: { x: number; y: number } | undefined, moved = false, original: Range | undefined, completed: Range | undefined, snapped = true, timer = 0;
  const word = (char: string) => /[\p{L}\p{M}\p{N}'’\u00ad-]/u.test(char);
  function describe(text: string) { return `${text.length}자 · “${text.length > 220 ? text.slice(0, 100) + ' … ' + text.slice(-100) : text}”`; }
  function apply(range: Range) { const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range.cloneRange()); }
  function finish() {
    const selection = getSelection();
    if (!moved || !selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    if (!pages.contains(range.startContainer) || !pages.contains(range.endContainer)) return;
    original = range.cloneRange(); completed = range.cloneRange();
    const a = range.startContainer, b = range.endContainer;
    if (a.nodeType === Node.TEXT_NODE && b.nodeType === Node.TEXT_NODE) {
      const left = a.textContent || '', right = b.textContent || '';
      let from = range.startOffset, to = range.endOffset;
      if (word(left[from] || '')) while (from > 0 && word(left[from - 1])) from--;
      if (to > 0 && word(right[to - 1])) while (to < right.length && word(right[to])) to++;
      completed.setStart(a, from); completed.setEnd(b, to);
    }
    snapped = true; apply(completed);
  }
  pages.addEventListener('pointerdown', event => {
    clearTimeout(timer); original = completed = undefined; moved = false;
    start = (event.target as Element).closest('.textLayer') && event.button === 0 ? { x: event.clientX, y: event.clientY } : undefined;
  });
  document.addEventListener('pointermove', event => {
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 3) moved = true;
  });
  document.addEventListener('selectionchange', () => {
    if (!start || !moved) return;
    const selection = getSelection(); if (!selection || !pages.contains(selection.anchorNode)) return;
    const text = selection.toString().trim(); live.textContent = '선택 중 · ' + describe(text); live.hidden = !text;
  });
  document.addEventListener('pointerup', event => {
    if (!start && !pages.contains(event.target as Node)) return;
    start = undefined; live.hidden = true;
    clearTimeout(timer); timer = window.setTimeout(() => { finish(); moved = false; capture(); }, 30);
  });
  pages.addEventListener('keyup', () => { original = completed = undefined; capture(); });
  toggle.onclick = () => { if (!original || !completed) return; snapped = !snapped; apply(snapped ? completed : original); capture(); };
  return {
    show(text: string, editing = false) {
      preview.textContent = '선택 원문 · ' + describe(text); preview.title = text; preview.hidden = !text;
      toggle.hidden = editing || !original || !completed || original.toString() === completed.toString();
      toggle.textContent = snapped ? '단어 끝 맞춤 ✓ · 원래 범위로' : '원래 범위 · 단어 끝 맞춤';
      toggle.setAttribute('aria-pressed', String(snapped));
    },
  };
}
