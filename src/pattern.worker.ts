import { CreateMLCEngine, type MLCEngine } from '@mlc-ai/web-llm';
import { patternModel, patternInstruction, parsePattern } from './sentence-pattern';

let engine: MLCEngine | undefined;
let busy = false;
self.onmessage = async (event: MessageEvent<{ sentence: string }>) => {
  if (busy) return;
  busy = true;
  try {
    const sentence = event.data.sentence;
    if (typeof sentence !== 'string' || !sentence.trim() || sentence.length > 1200) throw new Error('한 번에 1,200자 이내의 영어 문장을 분석해 주세요.');
    if (!engine) {
      const adapter = await navigator.gpu?.requestAdapter();
      if (!adapter?.features.has('shader-f16')) throw new Error('이 브라우저에서는 분석용 GPU를 사용할 수 없어요. 다른 컴퓨터에서 분석하거나 패턴을 직접 입력해 주세요.');
      engine = await CreateMLCEngine(patternModel, {
        initProgressCallback: report => self.postMessage({ type: 'progress', progress: report.progress }),
      }, { context_window_size: 4096 });
    }
    self.postMessage({ type: 'analyzing' });
    const reply = await engine.chat.completions.create({
      messages: [{ role: 'system', content: patternInstruction }, { role: 'user', content: sentence }],
      temperature: 0, max_tokens: 220, extra_body: { enable_thinking: false },
    });
    if (reply.choices[0]?.finish_reason === 'length') throw new Error('분석이 길어져 중단했어요. 문장을 짧게 나누거나 직접 입력해 주세요.');
    self.postMessage({ type: 'result', value: parsePattern(reply.choices[0]?.message.content || '') });
  } catch (error) {
    const message = error instanceof Error && /[가-힣]/.test(error.message) ? error.message : '분석 모델을 실행하지 못했어요. 인터넷·저장 공간·GPU 지원을 확인하거나 직접 입력해 주세요.';
    self.postMessage({ type: 'error', message });
  } finally { busy = false; }
};
