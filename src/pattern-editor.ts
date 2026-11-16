import { parsePattern, patternNote } from './sentence-pattern';
import type { createPatternClient } from './pattern-client';

export function setupPatternEditor() {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const panel = $<HTMLDetailsElement>('sentence-pattern');
  const input = $<HTMLTextAreaElement>('study-text'), note = $<HTMLTextAreaElement>('study-note');
  const pattern = $<HTMLInputElement>('pattern-value'), meaning = $<HTMLInputElement>('pattern-meaning');
  const run = $<HTMLButtonElement>('pattern-run'), cancel = $('pattern-cancel'), status = $('pattern-status');
  const apply = $<HTMLButtonElement>('pattern-apply');
  let client: ReturnType<typeof createPatternClient> | undefined;
  let revision = 0, busy = false, resultSentence = '';
  function setBusy(value: boolean) {
    busy = value; run.disabled = value; cancel.hidden = !value; apply.disabled = value;
    panel.setAttribute('aria-busy', String(value));
  }
  function stop() { revision++; client?.cancel(); setBusy(false); }
  cancel.onclick = () => { stop(); status.textContent = '분석을 취소했어요. 입력한 내용은 그대로 남아 있어요.'; };
  run.onclick = async () => {
    const sentence = input.value.trim();
    if (!/[a-z]/i.test(sentence) || sentence.length > 1200) { status.textContent = '1,200자 이내의 영어 문장을 먼저 입력해 주세요.'; return; }
    const token = ++revision; setBusy(true); status.textContent = '분석 모델을 준비합니다. 처음에는 다운로드에 시간이 걸릴 수 있어요.';
    try {
      const { createPatternClient } = await import('./pattern-client');
      if (token !== revision) return;
      client ??= createPatternClient();
      const result = await client.analyze(sentence, (stage, progress) => {
        if (token !== revision) return;
        status.textContent = stage === 'analyzing' ? '이 기기에서 문장 패턴을 분석하고 있어요…' : `모델 준비 중 ${Math.round(Math.max(0, Math.min(1, progress || 0)) * 100)}% · 처음에는 약 2.3GB를 내려받습니다.`;
      });
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
