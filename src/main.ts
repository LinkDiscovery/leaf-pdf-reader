import { getDocument, GlobalWorkerOptions, TextLayer, PasswordResponses, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { exportAnnotatedPdf } from './export';
import { setupReadingPreferences } from './preferences';
import layout from './app.html?raw';
import { documentHash, getHighlights, saveHighlights, colors, type Highlight, type Region, type Color } from './storage';
import { setupDictionary } from './dictionary';
import 'pdfjs-dist/web/pdf_viewer.css';
import './style.css';

document.querySelector('#app')!.innerHTML = layout;
GlobalWorkerOptions.workerSrc = workerUrl;
const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const reader = $('#reader-scroll');
const pages = $('#pages');
const fileInput = $<HTMLInputElement>('#file-input');
const pageInput = $<HTMLInputElement>('#page-number');
const tools = $('#selection-tools');
const search = setupDictionary();
$('#example-search').onclick = () => void search('curiosity');
setupReadingPreferences();
const passwordDialog = $<HTMLDialogElement>('#password-dialog');
const noteDialog = $<HTMLDialogElement>('#note-dialog');
const noteText = $<HTMLTextAreaElement>('#note-text');
let noteDraft: { documentId: string; id?: string; regions: Region[]; quote: string } | undefined;
type ZoomAnchor = { pageIndex: number; point: number[]; x: number; y: number };

let pdf: PDFDocumentProxy | undefined;
let loading: ReturnType<typeof getDocument> | undefined;
let original: Uint8Array<ArrayBuffer> | undefined;
let documentId = '';
let fileName = '';
let highlights: Highlight[] = [];
let saveQueue = Promise.resolve();
let saveRevision = 0;
let canSave = true;
let scale = 1;
let fitMode: 'width' | 'page' | 'custom' = 'width';
let current = 1;
let generation = 0;
let openGeneration = 0;
let observer: IntersectionObserver | undefined;
let selectedRegions: Region[] = [];
let selectedText = '';
let editingId: string | undefined;
let toastTimer = 0;
let selectionTimer = 0;
let zoomTimer = 0;
type PageView = { index: number; page: PDFPageProxy; viewport: ReturnType<PDFPageProxy['getViewport']>; element: HTMLElement; canvas?: HTMLCanvasElement; text?: TextLayer; task?: RenderTask; rendering?: Promise<void>; serial: number; mounted: boolean };
let views: PageView[] = [];

function notify(message: string) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = window.setTimeout(() => $('#toast').hidden = true, 6000);
}
function status(message: string) { $('#reader-status').textContent = message; }
function controls(enabled: boolean) {
  for (const id of ['prev-page','next-page','page-number','zoom-out','zoom-in','fit-width','fit-page','zoom-label','export-button'])
    $<HTMLButtonElement>('#' + id).disabled = !enabled;
}
function updatePageCounter() {
  pageInput.value = String(current); pageInput.max = String(pdf?.numPages ?? 1);
  $('#page-total').textContent = '/ ' + (pdf?.numPages ?? '—');
  $<HTMLButtonElement>('#prev-page').disabled = !pdf || current === 1;
  $<HTMLButtonElement>('#next-page').disabled = !pdf || current === pdf.numPages;
}
function closeTools() { tools.hidden = true; editingId = undefined; }
function positionTools(rect: DOMRect | { left: number; bottom: number }) {
  tools.hidden = false;
  tools.style.left = Math.max(12, Math.min(rect.left, innerWidth - tools.offsetWidth - 12)) + 'px';
  tools.style.top = Math.max(12, Math.min(rect.bottom + 10, innerHeight - tools.offsetHeight - 12)) + 'px';
}
function renderHighlights(view: PageView) {
  let overlay = view.element.querySelector<HTMLElement>('.highlight-layer');
  if (!overlay) { overlay = document.createElement('div'); overlay.className = 'highlight-layer'; view.element.append(overlay); }
  overlay.replaceChildren();
  let noteLayer = view.element.querySelector<HTMLElement>('.note-layer');
  if (!noteLayer) { noteLayer = document.createElement('div'); noteLayer.className = 'note-layer'; view.element.append(noteLayer); }
  noteLayer.replaceChildren();
  for (const highlight of highlights) {
    for (const region of highlight.regions.filter(r => r.pageIndex === view.index)) {
      const [x1,y1,x2,y2] = view.viewport.convertToViewportRectangle(region.rect);
      const mark = document.createElement('button');
      mark.className = 'highlight'; mark.dataset.id = highlight.id;
      mark.setAttribute('aria-label', '형광펜 수정');
      mark.style.cssText = 'left:' + Math.min(x1,x2) + 'px;top:' + Math.min(y1,y2) + 'px;width:' + Math.abs(x2-x1) + 'px;height:' + Math.abs(y2-y1) + 'px;background:' + colors[highlight.color];
      mark.onclick = event => {
        event.stopPropagation(); window.getSelection()?.removeAllRanges();
        clearTimeout(selectionTimer); editingId = highlight.id;
        selectedRegions = []; selectedText = '';
        $('#delete-highlight').hidden = false; $('#selection-lookup').hidden = true;
        $('#selection-label').textContent = '표시 수정';
        $('#selection-note').textContent = highlight.note ? '메모 보기·수정' : '메모 쓰기';
        $('#delete-highlight').textContent = highlight.note ? '표시·메모 삭제' : '삭제';
        positionTools(mark.getBoundingClientRect());
      };
      overlay.append(mark);
    }
    const region = highlight.regions.find(r => r.pageIndex === view.index);
    if (highlight.note && region) {
      const [x1,y1,x2,y2] = view.viewport.convertToViewportRectangle(region.rect);
      const pin = document.createElement('button');
      pin.className = 'note-pin'; pin.dataset.id = highlight.id; pin.textContent = '▤';
      pin.setAttribute('aria-label', '문장 메모 보기');
      pin.title = highlight.note.slice(0, 120);
      pin.style.left = Math.max(0, Math.min(Math.max(x1,x2) + 5, view.viewport.width - 26)) + 'px';
      pin.style.top = Math.max(0, Math.min(Math.min(y1,y2), view.viewport.height - 26)) + 'px';
      pin.onclick = event => { event.stopPropagation(); openNote(highlight.id); };
      noteLayer.append(pin);
    }
  }
}
function refreshHighlights() {
  $('#highlight-count').textContent = String(highlights.length);
  const count = highlights.filter(h => h.note).length;
  $('#note-count').textContent = count ? '· 메모 ' + count : '';
  for (const view of views) if (view.mounted) renderHighlights(view);
}
function persist() {
  refreshHighlights();
  if (!canSave) { notify('저장소를 사용할 수 없어 표시를 자동 저장하지 못했어요. PDF로 내보내 보관하세요.'); return; }
  const id = documentId; const snapshot = structuredClone(highlights); const revision = ++saveRevision;
  $('#save-status').textContent = '저장 중…';
  saveQueue = saveQueue.catch(() => {}).then(() => saveHighlights(id, snapshot)).then(() => {
    if (id === documentId && revision === saveRevision) $('#save-status').textContent = '✓ 자동 저장됨';
  }).catch(() => {
    if (id === documentId) { $('#save-status').textContent = '저장 실패'; notify('표시를 저장하지 못했어요. PDF로 내보내 보관해 주세요.'); }
  });
}
function unmount(view: PageView) {
  view.serial++; view.task?.cancel(); view.text?.cancel();
  view.task = undefined; view.text = undefined; view.mounted = false;
  if (view.canvas) { view.canvas.width = 0; view.canvas.height = 0; view.canvas = undefined; }
  delete view.element.dataset.ready; view.element.replaceChildren();
}
function mount(view: PageView) {
  if (view.mounted) return;
  view.mounted = true;
  const serial = ++view.serial;
  const previous = view.rendering;
  view.rendering = (async () => {
    await previous?.catch(() => {});
    if (!view.mounted || view.serial !== serial) return;
    const canvas = document.createElement('canvas');
    view.canvas = canvas;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.ceil(view.viewport.width * dpr); canvas.height = Math.ceil(view.viewport.height * dpr);
    canvas.style.width = view.viewport.width + 'px'; canvas.style.height = view.viewport.height + 'px';
    view.element.append(canvas);
    view.task = view.page.render({ canvas, viewport: view.viewport, transform: [dpr,0,0,dpr,0,0] });
    await view.task.promise;
    if (!view.mounted || view.serial !== serial) return;
    const content = await view.page.getTextContent();
    if (!view.mounted || view.serial !== serial) return;
    const layer = document.createElement('div');
    layer.className = 'textLayer';
    view.element.append(layer);
    view.text = new TextLayer({ textContentSource: content, container: layer, viewport: view.viewport });
    await view.text.render();
    if (!view.mounted || view.serial !== serial) return;
    if (!content.items.some(item => 'str' in item && item.str.trim())) {
      const note = document.createElement('div'); note.className = 'scan-notice'; note.textContent = '텍스트가 없는 페이지예요. 단어 선택에는 OCR이 필요해요.'; view.element.append(note);
    }
    renderHighlights(view); view.element.dataset.ready = 'true';
  })().catch(error => {
    if (view.serial !== serial || error?.name === 'RenderingCancelledException' || error?.name === 'AbortException') return;
    const note = document.createElement('div'); note.className = 'scan-notice'; note.textContent = '페이지를 표시하지 못했어요. 다시 열어 주세요.'; view.element.append(note);
    console.error(error);
  });
}
function resetViews() {
  observer?.disconnect();
  for (const view of views) unmount(view);
  views = []; pages.replaceChildren();
}
async function buildViews(targetPage = 1, anchor?: ZoomAnchor) {
  if (!pdf) return;
  const token = ++generation;
  const doc = pdf;
  closeTools(); window.getSelection()?.removeAllRanges(); resetViews();
  try {
  const firstPage = await doc.getPage(targetPage);
  if (token !== generation) return;
  const natural = firstPage.getViewport({ scale: 1 });
  if (fitMode !== 'custom') {
    const widthScale = (reader.clientWidth - 64) / natural.width;
    scale = Math.max(.25, Math.min(4, fitMode === 'page' ? Math.min(widthScale, (reader.clientHeight - 48) / natural.height) : widthScale));
  }
  updateZoomLabel();
  $('#fit-width').classList.toggle('active', fitMode === 'width');
  $('#fit-page').classList.toggle('active', fitMode === 'page');
  observer = new IntersectionObserver(entries => {
    const selection = window.getSelection();
    for (const entry of entries) {
      const view = views[Number((entry.target as HTMLElement).dataset.index)];
      if (!view) continue;
      if (entry.isIntersecting) mount(view);
      else if (selection?.isCollapsed !== false) unmount(view);
    }
  }, { root: reader, rootMargin: '700px 0px' });
  for (let index = 0; index < doc.numPages; index++) {
    const page = await doc.getPage(index + 1);
    if (token !== generation) return;
    const viewport = page.getViewport({ scale });
    const element = document.createElement('div');
    element.className = 'pdf-page'; element.dataset.index = String(index); element.setAttribute('aria-label', (index + 1) + ' 페이지');
    element.style.width = viewport.width + 'px'; element.style.height = viewport.height + 'px';
    element.style.setProperty('--scale-factor', String(scale * viewport.userUnit));
    const view: PageView = { index, page, viewport, element, serial: 0, mounted: false };
    views.push(view); pages.append(element); observer.observe(element);
  }
  if (anchor && views[anchor.pageIndex]) {
    const view = views[anchor.pageIndex];
    const [x,y] = view.viewport.convertToViewportPoint(anchor.point[0], anchor.point[1]);
    reader.scrollTo({left:view.element.offsetLeft + x - anchor.x, top:view.element.offsetTop + y - anchor.y, behavior:'instant'});
    current = anchor.pageIndex + 1; updatePageCounter(); mount(view);
  } else goToPage(targetPage);
  } catch (error) {
    if (token === generation) { status('페이지를 표시하지 못했어요. PDF를 다시 열어 주세요.'); console.error(error); }
  }
}
function goToPage(value: number) {
  if (!pdf || !Number.isFinite(value)) return;
  current = Math.max(1, Math.min(pdf.numPages, Math.round(value)));
  const view = views[current - 1];
  if (view) { reader.scrollTo({ top: view.element.getBoundingClientRect().top - reader.getBoundingClientRect().top + reader.scrollTop - 24, left: Math.max(0, view.element.offsetLeft + view.viewport.width / 2 - reader.clientWidth / 2), behavior: 'instant' }); mount(view); }
  updatePageCounter(); closeTools();
}
async function openFile(file: File) {
  if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') { notify('PDF 파일을 선택해 주세요.'); return; }
  const token = ++openGeneration;
  let passwordCancelled = false;
  generation++; clearTimeout(wheelTimer); controls(false); closeTools();
  if (noteDialog.open) noteDialog.close(); noteDraft = undefined;
  status('PDF를 여는 중…'); $('#save-status').textContent = '파일 확인 중';
  passwordDialog.open && passwordDialog.close('cancel');
  await saveQueue;
  const oldLoading = loading; loading = undefined; pdf = undefined;
  resetViews(); original = undefined; documentId = ''; highlights = []; refreshHighlights();
  await oldLoading?.destroy().catch(() => {});
  if (token !== openGeneration) return;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const id = await documentHash(bytes);
    if (token !== openGeneration) return;
    const task = getDocument({ data: bytes.slice(), cMapUrl: '/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/' });
    loading = task;
    task.onPassword = (updatePassword: (password: string) => void, reason: number) => {
      if (token !== openGeneration) return;
      $('#password-message').textContent = reason === PasswordResponses.INCORRECT_PASSWORD ? '비밀번호가 맞지 않아요. 다시 입력하세요.' : '파일을 열려면 비밀번호를 입력하세요.';
      $<HTMLInputElement>('#pdf-password').value = '';
      passwordDialog.onclose = () => {
        if (token !== openGeneration) return;
        if (passwordDialog.returnValue === 'open') updatePassword($<HTMLInputElement>('#pdf-password').value);
        else { passwordCancelled = true; void task.destroy(); status('비밀번호 입력을 취소했어요.'); $('#save-status').textContent = '열기 취소됨'; $('#welcome').hidden = false; }
      };
      passwordDialog.showModal();
    };
    const document = await task.promise;
    if (token !== openGeneration) { await task.destroy(); return; }
    let restored: Highlight[] = [];
    let storageAvailable = true;
    try { restored = await getHighlights(id); }
    catch { storageAvailable = false; }
    if (token !== openGeneration) return;
    pdf = document; original = bytes; documentId = id; fileName = file.name; current = 1; fitMode = 'width';
    highlights = restored; canSave = storageAvailable;
    if (!canSave) notify('브라우저 저장소에 접근할 수 없어요. 표시는 PDF로 내보내 보관할 수 있어요.');
    $('#file-name').textContent = fileName; $('#welcome').hidden = true;
    $('#save-status').textContent = canSave ? '✓ 자동 저장 준비됨' : '저장소 사용 불가';
    refreshHighlights(); controls(true); updatePageCounter();
    await buildViews();
    if (token === openGeneration) status('문장 드래그 → 형광펜·메모 · Ctrl+휠 → 확대·축소');
  } catch (error) {
    if (token !== openGeneration || passwordCancelled) return;
    pdf = undefined; controls(false); $('#welcome').hidden = false;
    const message = error instanceof Error ? error.message : String(error);
    status('PDF를 열지 못했어요.');
    $('#save-status').textContent = '열기 실패';
    notify('PDF를 열지 못했어요. 손상되었거나 지원하지 않는 파일일 수 있어요. ' + message.slice(0, 120));
  }
}
function captureSelection() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) { if (!editingId) closeTools(); return; }
  const range = selection.getRangeAt(0);
  if (!pages.contains(range.startContainer) || !pages.contains(range.endContainer)) return;
  selectedRegions = []; selectedText = selection.toString().trim(); editingId = undefined;
  for (const view of views) {
    if (!view.mounted) continue;
    const layer = view.element.querySelector('.textLayer');
    if (!layer || !range.intersectsNode(layer)) continue;
    const box = view.element.getBoundingClientRect();
    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    const rects: { left: number; top: number; right: number; bottom: number }[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!node.textContent?.trim() || !range.intersectsNode(node)) continue;
      const part = document.createRange();
      part.selectNodeContents(node);
      if (node === range.startContainer) part.setStart(node, range.startOffset);
      if (node === range.endContainer) part.setEnd(node, range.endOffset);
      for (const rect of part.getClientRects()) {
        const clipped = { left: Math.max(box.left, rect.left), top: Math.max(box.top, rect.top), right: Math.min(box.right, rect.right), bottom: Math.min(box.bottom, rect.bottom) };
        if (clipped.right - clipped.left < 1 || clipped.bottom - clipped.top < 1) continue;
        if (rects.some(r => Math.abs(r.left - clipped.left) < .5 && Math.abs(r.top - clipped.top) < .5 && Math.abs(r.right - clipped.right) < .5)) continue;
        rects.push(clipped);
      }
    }
    // Merge adjacent runs on the same visual line so opacity does not stack.
    rects.sort((a,b) => a.top - b.top || a.left - b.left);
    const merged: typeof rects = [];
    for (const rect of rects) {
      const last = merged.at(-1);
      if (last && Math.abs(last.top - rect.top) < 2 && Math.abs(last.bottom - rect.bottom) < 2 && rect.left <= last.right + 4) last.right = Math.max(last.right, rect.right);
      else merged.push({ ...rect });
    }
    for (const rect of merged) {
      const [x1,y1] = view.viewport.convertToPdfPoint(rect.left-box.left, rect.top-box.top);
      const [x2,y2] = view.viewport.convertToPdfPoint(rect.right-box.left, rect.bottom-box.top);
      selectedRegions.push({ pageIndex: view.index, rect: [Math.min(x1,x2),Math.min(y1,y2),Math.max(x1,x2),Math.max(y1,y2)] });
    }
  }
  if (!selectedRegions.length || !selectedText) { closeTools(); return; }
  $('#selection-label').textContent = '선택한 문장';
  $('#selection-note').textContent = '메모 쓰기';
  $('#delete-highlight').textContent = '삭제';
  $('#delete-highlight').hidden = true; $('#selection-lookup').hidden = false;
  positionTools(range.getBoundingClientRect());
}
for (const button of tools.querySelectorAll<HTMLButtonElement>('[data-color]')) {
  button.onclick = () => {
    const color = button.dataset.color as Color;
    if (editingId) highlights = highlights.map(h => h.id === editingId ? { ...h, color } : h);
    else if (selectedRegions.length) highlights.push({ id: crypto.randomUUID(), documentId, color, regions: structuredClone(selectedRegions) });
    else return;
    persist(); window.getSelection()?.removeAllRanges(); closeTools();
  };
}

function openNote(id?: string) {
  const highlight = id ? highlights.find(h => h.id === id) : undefined;
  const regions = highlight?.regions ?? selectedRegions;
  if (!regions.length || !documentId) return;
  noteDraft = { documentId, id:highlight?.id, regions:structuredClone(regions), quote:highlight?.quote || (id ? '' : selectedText).slice(0,2000) };
  $('#note-title').textContent = highlight?.note ? '문장 메모 수정' : '문장에 메모';
  const indices = [...new Set(regions.map(region => region.pageIndex + 1))];
  $('#note-page-label').textContent = indices.join(', ') + '쪽에 연결된 메모';
  $('#note-quote').textContent = noteDraft.quote || '형광펜으로 표시한 문장';
  $('#note-create-hint').hidden = !!highlight;
  $('#note-remove').hidden = !highlight?.note;
  noteText.value = highlight?.note || '';
  noteText.setCustomValidity('');
  $('#note-length').textContent = noteText.value.length + ' / 4000';
  clearTimeout(selectionTimer); closeTools(); window.getSelection()?.removeAllRanges();
  noteDialog.showModal(); noteText.focus();
}
noteText.oninput = () => { noteText.setCustomValidity(''); $('#note-length').textContent = noteText.value.length + ' / 4000'; };
$('#selection-note').onclick = () => openNote(editingId);
$('#note-cancel').onclick = $('#note-dismiss').onclick = () => noteDialog.close();
noteDialog.onclose = () => { noteDraft = undefined; };
$<HTMLFormElement>('#note-form').onsubmit = event => {
  event.preventDefault();
  if (!noteDraft || noteDraft.documentId !== documentId) { noteDialog.close(); return; }
  const text = noteText.value.trim();
  if (!text) { noteText.setCustomValidity('메모 내용을 입력하세요.'); noteText.reportValidity(); return; }
  if (noteDraft.id) highlights = highlights.map(h => h.id === noteDraft!.id ? { ...h, note:text, quote:noteDraft!.quote || h.quote } : h);
  else highlights.push({id:crypto.randomUUID(),documentId,color:'yellow',regions:noteDraft.regions,note:text,quote:noteDraft.quote});
  persist(); noteDialog.close();
};
$('#note-remove').onclick = () => {
  if (!noteDraft || noteDraft.documentId !== documentId) return;
  highlights = highlights.map(h => {
    if (h.id !== noteDraft!.id) return h;
    const {note, quote, ...rest} = h;
    return rest;
  });
  persist(); noteDialog.close();
};

tools.addEventListener('pointerdown', event => event.preventDefault());
$('#delete-highlight').onclick = () => { highlights = highlights.filter(h => h.id !== editingId); persist(); closeTools(); };
$('#selection-lookup').onclick = () => { void search(selectedText); closeTools(); };
$('#close-selection').onclick = closeTools;
pages.addEventListener('pointerup', () => { clearTimeout(selectionTimer); selectionTimer = window.setTimeout(captureSelection, 30); });
pages.addEventListener('keyup', captureSelection);
pages.addEventListener('dblclick', () => { const word = window.getSelection()?.toString(); if (word) void search(word); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeTools(); });
document.addEventListener('pointerdown', event => { if (!tools.contains(event.target as Node) && !(event.target as HTMLElement).closest('.highlight')) closeTools(); });
reader.addEventListener('scroll', () => {
  closeTools();
  if (!pdf) return;
  const bounds = reader.getBoundingClientRect();
  const nearest = views.find(view => view.element.getBoundingClientRect().bottom > bounds.top + Math.min(160, bounds.height / 3));
  if (nearest && current !== nearest.index + 1) { current = nearest.index + 1; updatePageCounter(); }
  if (window.getSelection()?.isCollapsed !== false) for (const view of views) {
    const rect = view.element.getBoundingClientRect();
    if (view.mounted && (rect.bottom < bounds.top - 900 || rect.top > bounds.bottom + 900)) unmount(view);
  }
});
$('#prev-page').onclick = () => goToPage(current - 1);
$('#next-page').onclick = () => goToPage(current + 1);
pageInput.onchange = () => goToPage(Number(pageInput.value));
function updateZoomLabel() {
  const percent = Math.round(scale * 100);
  const select = $<HTMLSelectElement>('#zoom-label');
  const custom = select.querySelector<HTMLOptionElement>('option[value="custom"]')!;
  custom.textContent = percent + '%';
  select.value = [...select.options].some(option => option.value === String(percent)) ? String(percent) : 'custom';
}
function anchorAt(clientX?: number, clientY?: number): ZoomAnchor | undefined {
  const box = reader.getBoundingClientRect();
  const x = clientX ?? box.left + box.width / 2;
  const y = clientY ?? box.top + box.height / 2;
  const view = views.find(v => {
    const rect = v.element.getBoundingClientRect();
    return rect.top <= y && rect.bottom >= y && rect.left <= x && rect.right >= x;
  }) ?? views[current - 1];
  if (!view) return;
  const rect = view.element.getBoundingClientRect();
  return { pageIndex:view.index, point:view.viewport.convertToPdfPoint(x-rect.left,y-rect.top), x:x-box.left, y:y-box.top };
}
let wheelTimer = 0;
let pendingWheelAnchor: ZoomAnchor | undefined;
function zoomTo(value: number, anchor = anchorAt()) {
  if (!pdf || !Number.isFinite(value)) return;
  clearTimeout(wheelTimer);
  fitMode = 'custom'; scale = Math.max(.25, Math.min(4,value));
  void buildViews(anchor ? anchor.pageIndex + 1 : current, anchor);
}
function zoom(delta: number) { zoomTo(Math.round((scale + delta) * 100) / 100); }
$('#zoom-out').onclick = () => zoom(-.15);
$('#zoom-in').onclick = () => zoom(.15);
$<HTMLSelectElement>('#zoom-label').onchange = event => zoomTo(Number((event.target as HTMLSelectElement).value) / 100);
$('#fit-width').onclick = () => { clearTimeout(wheelTimer); fitMode = 'width'; void buildViews(current); };
$('#fit-page').onclick = () => { clearTimeout(wheelTimer); fitMode = 'page'; void buildViews(current); };
reader.addEventListener('wheel', event => {
  if (!(event.ctrlKey || event.metaKey) || !pdf || noteDialog.open) return;
  event.preventDefault();
  pendingWheelAnchor = anchorAt(event.clientX,event.clientY);
  fitMode = 'custom';
  scale = Math.max(.25,Math.min(4,scale * Math.exp(-event.deltaY * (event.deltaMode === 1 ? .04 : .002))));
  updateZoomLabel(); clearTimeout(wheelTimer);
  wheelTimer = window.setTimeout(() => zoomTo(scale,pendingWheelAnchor), 100);
}, {passive:false});
document.addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey) || !pdf || noteDialog.open || passwordDialog.open) return;
  const target = event.target as HTMLElement;
  if (target.closest('input,textarea,select,.dictionary') || target.isContentEditable) return;
  if (['+','=','-','0'].includes(event.key)) {
    event.preventDefault();
    if (event.key === '0') { clearTimeout(wheelTimer); fitMode = 'width'; void buildViews(current); }
    else zoom(event.key === '-' ? -.15 : .15);
  }
});
let lastWidth = reader.clientWidth;
let lastHeight = reader.clientHeight;
new ResizeObserver(() => {
  if (reader.clientWidth === lastWidth && reader.clientHeight === lastHeight) return;
  lastWidth = reader.clientWidth; lastHeight = reader.clientHeight;
  if (fitMode !== 'custom' && pdf) { clearTimeout(zoomTimer); zoomTimer = window.setTimeout(() => { const anchor = anchorAt(); void buildViews(anchor ? anchor.pageIndex + 1 : current, anchor); }, 150); }
}).observe(reader);
$('#open-button').onclick = $('#drop-open').onclick = () => fileInput.click();
fileInput.onchange = () => { const file = fileInput.files?.[0]; if (file) void openFile(file); fileInput.value = ''; };
let dragDepth = 0;
document.addEventListener('dragenter', event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); dragDepth++; $('#drop-overlay').hidden = false; } });
document.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#drop-overlay').hidden = true; } });
document.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; $('#drop-overlay').hidden = true; const file = event.dataTransfer?.files[0]; if (file) void openFile(file); });
$('#export-button').onclick = async () => {
  if (!original) return;
  const button = $<HTMLButtonElement>('#export-button');
  const bytes = original.slice(); const marks = structuredClone(highlights); const name = fileName;
  button.disabled = true; button.textContent = '내보내는 중…';
  try {
    const buffer = await exportAnnotatedPdf(bytes, marks);
    const blob = new Blob([new Uint8Array(buffer)], { type:'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = name.replace(/\.pdf$/i,'') + '-형광펜.pdf'; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    notify(marks.some(mark => mark.note) ? '형광펜과 메모가 포함된 PDF를 내보냈어요. 메모는 PDF 뷰어의 주석에서 볼 수 있어요.' : '형광펜이 포함된 PDF 복사본을 내보냈어요.');
  } catch (error) {
    notify(String(error).includes('encrypted') ? '암호화된 PDF 내보내기는 아직 지원하지 않아요. 표시는 이 앱에 저장됩니다.' : 'PDF를 내보내지 못했어요. 파일을 다시 열고 시도해 주세요.');
  } finally { button.disabled = !pdf; button.textContent = '↗ PDF 내보내기'; }
};




