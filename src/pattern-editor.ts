import { parsePattern, patternNote } from './sentence-pattern';
import { createPatternClient, checkPatternServer, defaultPatternServer, patternServer } from './pattern-client';

export function setupPatternEditor() {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const panel = $<HTMLDetailsElement>('sentence-pattern');
  const input = $<HTMLTextAreaElement>('study-text'), note = $<HTMLTextAreaElement>('study-note');
  const pattern = $<HTMLInputElement>('pattern-value'), meaning = $<HTMLInputElement>('pattern-meaning');
  const run = $<HTMLButtonElement>('pattern-run'), cancel = $('pattern-cancel'), status = $('pattern-status');
  const apply = $<HTMLButtonElement>('pattern-apply');
  const endpoint = $<HTMLInputElement>('pattern-server'), check = $<HTMLButtonElement>('pattern-check');
  try { endpoint.value = localStorage.getItem('leaf-pattern-server') || defaultPatternServer; } catch { endpoint.value = defaultPatternServer; }
  let checking: AbortController | undefined;
  function serverAddress() {
    const base = patternServer(endpoint.value.trim());
    try { localStorage.setItem('leaf-pattern-server', base); } catch { /* Connection still works without persistence. */ }
    return base;
  }
  let client: ReturnType<typeof createPatternClient> | undefined;
  let revision = 0, busy = false, resultSentence = '';
  function setBusy(value: boolean) {
    busy = value; run.disabled = value; cancel.hidden = !value; apply.disabled = value; check.disabled = value;
    panel.setAttribute('aria-busy', String(value));
  }
  function stop() { revision++; client?.cancel(); checking?.abort(); checking = undefined; setBusy(false); }
  endpoint.oninput = () => { stop(); status.textContent = '연결 주소가 바뀌었어요. 연결을 확인한 뒤 분석해 주세요.'; };
  check.onclick = async () => {
    stop(); const token = revision; checking = new AbortController(); check.disabled = true;
    status.textContent = 'Ollama 연결을 확인합니다…';
    try {
      const info = await checkPatternServer(serverAddress(), AbortSignal.any([checking.signal, AbortSignal.timeout(6000)]));
      if (token === revision) status.textContent = `${info.model} 연결됨 · ${info.cpu ? 'CPU 모드' : '자동 모드'} · 분석 시작을 누르세요.`;
    } catch (error) {
      if (token === revision) status.textContent = error instanceof Error && /[가-힣]/.test(error.message) ? error.message : 'Ollama와 연결 프로그램을 실행해 주세요. 로컬 네트워크 접근 요청이 나오면 허용해 주세요.';
    } finally { if (token === revision) { checking = undefined; check.disabled = false; } }
  };
  cancel.onclick = () => { stop(); status.textContent = '분석을 취소했어요. 입력한 내용은 그대로 남아 있어요.'; };
  run.onclick = async () => {
    const sentence = input.value.trim();
    if (!/[a-z]/i.test(sentence) || sentence.length > 1200) { status.textContent = '1,200자 이내의 영어 문장을 먼저 입력해 주세요.'; return; }
    checking?.abort(); checking = undefined;
    const token = ++revision; setBusy(true); status.textContent = 'Ollama 연결을 확인합니다…';
    try {
      if (token !== revision) return;
      client ??= createPatternClient();
      const result = await client.analyze(sentence, stage => {
        if (token !== revision) return;
        status.textContent = stage === 'analyzing' ? '연결된 Ollama에서 문장 패턴을 분석하고 있어요… CPU에서는 시간이 걸릴 수 있어요.' : 'Ollama 연결을 확인합니다…';
      }, serverAddress());
      if (token !== revision) return;
      if (input.value.trim() !== sentence) { status.textContent = '분석 중 원문이 바뀌어 결과를 적용하지 않았어요. 새 문장으로 다시 분석해 주세요.'; return; }
      const value = parsePattern(JSON.stringify(result));
      pattern.value = value.pattern; meaning.value = value.meaning; resultSentence = sentence;
      status.textContent = '분석 초안을 확인·수정한 뒤 “메모에 넣기”를 누르세요. AI 분석은 틀릴 수 있어요.';
    } catch (error) {
      if (token === revision) status.textContent = error instanceof Error ? error.message : '분석하지 못했어요. 직접 입력하거나 다시 시도해 주세요.';
    } finally { if (token === revision) setBusy(false); }
  };
  apply.onclick = () => {
    try {
      if (resultSentence && resultSentence !== input.value.trim()) throw new Error('원문이 바뀌었어요. 새 문장으로 다시 분석하거나 패턴을 확인해 직접 수정해 주세요.');
      const value = parsePattern(JSON.stringify({ pattern: pattern.value, meaning: meaning.value }));
      note.value = patternNote(note.value, value);
      status.textContent = '메모에 넣었어요. 아래 “저장”을 누르면 문장과 함께 저장됩니다.';
    } catch (error) { status.textContent = error instanceof Error ? error.message : '패턴과 뜻을 확인해 주세요.'; }
  };
  pattern.oninput = meaning.oninput = () => { resultSentence = ''; };
  input.addEventListener('input', () => {
    if (busy) { stop(); status.textContent = '원문이 바뀌어 분석을 취소했어요. 새 문장으로 다시 시작해 주세요.'; }
  });
  $('study-editor').addEventListener('close', stop);
  return {
    open(sentence: boolean, expand = false) {
      stop(); panel.hidden = !sentence; panel.open = sentence && expand;
      pattern.value = ''; meaning.value = ''; resultSentence = ''; status.textContent = '';
      const saved = /^문장 패턴: ([^\r\n]+)\r?\n패턴 뜻: ([^\r\n]+)/.exec(note.value);
      if (sentence && saved) { pattern.value = saved[1]; meaning.value = saved[2]; resultSentence = input.value.trim(); }
    },
  };
}
