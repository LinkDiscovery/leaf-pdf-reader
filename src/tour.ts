import './tour.css';

const seenKey = 'leaf-tour-seen';
type Step = { target: string; title: string; body: string; demo?: boolean };
const steps: Step[] = [
  { target: '#open-button', title: '내 PDF로 시작하세요', body: '여기를 눌러 내 폴더의 PDF를 엽니다. 파일을 화면에 끌어놓아도 돼요. PDF 원본은 업로드하지 않습니다.' },
  { target: '#dictionary-form', title: '모르는 표현의 뜻 찾기', body: 'PDF의 단어를 두 번 클릭하면 사전에 뜻이 나옵니다. 여기에 단어나 문장을 직접 입력할 수도 있어요.' },
  { target: '[data-tour-color]', title: '드래그하면 형광펜 메뉴가 열려요', body: '이 화면은 선택 메뉴 예시입니다. 실제 PDF에서 단어나 문장을 드래그한 뒤 색을 누르면 형광펜이 칠해집니다.', demo: true },
  { target: '[data-tour-word]', title: '여기서 바로 단어장에 추가', body: '사전으로 이동하지 않아도 됩니다. 단어를 선택하고 이 버튼을 누르면 원문·예문·출처를 채운 저장 창이 열려요. 뜻을 확인하거나 직접 입력한 뒤 저장하세요.', demo: true },
  { target: '[data-tour-sentence]', title: '문장은 따로 모으세요', body: '문장을 선택한 뒤 문장 저장을 누르세요. 이미 조회한 번역이 있으면 함께 채웁니다. 새로 칠한 형광펜을 다시 눌러 단어·문장을 저장할 수도 있어요.', demo: true },
  { target: '#tab-words', title: '모은 표현을 다시 복습', body: '나의 단어장과 나의 문장 탭에서 검색·수정하고, 뜻을 가린 채 복습할 수 있어요. PDF 읽기 탭으로 돌아가면 읽던 위치가 유지됩니다.' },
  { target: '#ui-font-size', title: '편한 글자 크기를 고르세요', body: '화면 글자를 기본·크게·아주 크게로 바꿉니다. 사전 글자는 A− / A＋, PDF 원문은 배율로 따로 조절하세요.' },
  { target: '.study-account', title: '같은 계정으로 이어서 학습', body: 'Google 로그인하면 단어·문장을 계정에 동기화합니다. 로그인 전 기록은 기기 기록 가져오기로 옮기세요. PDF와 PDF 형광펜·메모는 동기화하지 않습니다.' },
  { target: '#help-open', title: '필요할 때 다시 안내받기', body: '사용법을 누르면 이 안내를 다시 볼 수 있어요. 아래 전체 사용법에는 메모·내보내기·백업과 단축키도 정리되어 있습니다. 이제 직접 시작해 보세요!' },
];

export function setupTour(showReference: () => void) {
  const dialog = document.createElement('dialog');
  dialog.id = 'tour-dialog'; dialog.setAttribute('aria-labelledby', 'tour-title'); dialog.setAttribute('aria-describedby', 'tour-description');
  dialog.innerHTML = `<div id="tour-demo" hidden aria-hidden="true"><p class="tour-demo-label">선택 메뉴 미리보기 · 실제 기록은 바뀌지 않아요</p><p class="tour-sample">Reading helps us <mark>retain</mark> words.</p><div class="tour-demo-tools"></div></div>
    <div id="tour-spotlight" aria-hidden="true"></div>
    <section id="tour-card"><div class="tour-card-top"><span id="tour-progress"></span><button id="tour-skip" class="text-button" autofocus>건너뛰기</button></div><div aria-live="polite" aria-atomic="true"><h2 id="tour-title"></h2><p id="tour-description"></p></div><div class="tour-actions"><button id="tour-reference" class="text-button">전체 사용법</button><button id="tour-prev" class="button secondary">이전</button><button id="tour-next" class="button primary">다음</button></div></section>`;
  document.body.append(dialog);
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!;
  const card = $('#tour-card'), spot = $('#tour-spotlight'), demo = $('#tour-demo');
  let index = 0, frame = 0;
  let previousTab: HTMLElement | null = null, previousFocus: HTMLElement | null = null;
  let scrollPositions: { element: Element; top: number; left: number }[] = [];
  let windowPosition = { x: 0, y: 0 };

  // Use the real control labels and styles, but no handlers or duplicate IDs.
  for (const selector of ['[data-color="yellow"]', '[data-color="green"]', '[data-color="pink"]', '#selection-word-save', '#selection-save', '#selection-note']) {
    const source = document.querySelector<HTMLButtonElement>(selector)!;
    const button = source.cloneNode(true) as HTMLButtonElement;
    button.removeAttribute('id'); button.tabIndex = -1; button.disabled = false;
    if (source.dataset.color) button.dataset.tourColor = '';
    if (source.id === 'selection-word-save') button.dataset.tourWord = '';
    if (source.id === 'selection-save') button.dataset.tourSentence = '';
    $('.tour-demo-tools').append(button);
  }
  demo.inert = true;
  function position() {
    if (!dialog.open) return;
    const target = document.querySelector<HTMLElement>(steps[index].target)!;
    const rect = target.getBoundingClientRect();
    const left = Math.max(6, rect.left - 6), top = Math.max(6, rect.top - 6);
    const right = Math.min(innerWidth - 6, rect.right + 6), bottom = Math.min(innerHeight - 6, rect.bottom + 6);
    Object.assign(spot.style, { left: left + 'px', top: top + 'px', width: Math.max(0, right - left) + 'px', height: Math.max(0, bottom - top) + 'px' });
    const height = card.offsetHeight, width = card.offsetWidth;
    let y = bottom + 16;
    if (y + height > innerHeight - 12) y = top - height - 16;
    if (y < 12) y = Math.max(12, innerHeight - height - 12);
    const x = Math.max(12, Math.min(left, innerWidth - width - 12));
    card.style.left = x + 'px'; card.style.top = y + 'px';
  }
  function schedule() { cancelAnimationFrame(frame); frame = requestAnimationFrame(position); }
  function render() {
    const step = steps[index];
    demo.hidden = !step.demo;
    $('#tour-title').textContent = step.title;
    $('#tour-description').textContent = step.body;
    $('#tour-progress').textContent = `${index + 1} / ${steps.length} · 처음 사용 안내`;
    $<HTMLButtonElement>('#tour-prev').disabled = index === 0;
    $('#tour-next').textContent = index === steps.length - 1 ? '시작하기' : '다음';
    if (!step.demo) document.querySelector(step.target)!.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    position(); schedule();
  }
  function finish() { dialog.close(); }
  dialog.addEventListener('close', () => {
    cancelAnimationFrame(frame);
    try { localStorage.setItem(seenKey, '1'); } catch {}
    if (previousTab?.id !== 'tab-reader') previousTab?.click();
    for (const saved of scrollPositions) saved.element.scrollTo(saved.left, saved.top);
    window.scrollTo(windowPosition.x, windowPosition.y);
    previousFocus?.focus({ preventScroll: true });
  });
  $('#tour-skip').onclick = finish;
  $('#tour-next').onclick = () => { if (index === steps.length - 1) finish(); else { index++; render(); } };
  $('#tour-prev').onclick = () => { if (index > 0) { index--; render(); } };
  $('#tour-reference').onclick = () => { finish(); requestAnimationFrame(showReference); };
  window.addEventListener('resize', schedule);
  document.addEventListener('scroll', schedule, true);
  new ResizeObserver(schedule).observe(card);
  function start() {
    if (dialog.open || document.querySelector('dialog[open]')) return;
    previousTab = document.querySelector('[role=tab][aria-selected=true]');
    previousFocus = document.activeElement as HTMLElement;
    windowPosition = { x: window.scrollX, y: window.scrollY };
    scrollPositions = ['#reader-scroll', '#study-panel', '.dictionary-body'].map(selector => {
      const element = document.querySelector(selector)!; return { element, top: element.scrollTop, left: element.scrollLeft };
    });
    if (previousTab?.id !== 'tab-reader') document.getElementById('tab-reader')!.click();
    index = 0; dialog.showModal(); render();
  }
  let seen = false;
  try { seen = localStorage.getItem(seenKey) === '1'; } catch {}
  if (!seen) requestAnimationFrame(start);
  return start;
}
