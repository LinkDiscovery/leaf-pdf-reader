import type { SentencePattern } from './sentence-pattern';
type Progress = (stage: 'loading' | 'analyzing', progress?: number) => void;
export function createPatternClient() {
  let worker: Worker | undefined;
  let pending: { resolve: (value: SentencePattern) => void; reject: (error: Error) => void; progress: Progress } | undefined;
  let timer = 0;
  function cancel() {
    clearTimeout(timer);
    worker?.terminate(); worker = undefined;
    pending?.reject(new Error('분석을 취소했어요.')); pending = undefined;
  }
  function deadline(milliseconds: number) {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      const reject = pending?.reject; pending = undefined; cancel();
      reject?.(new Error('분석이 오래 걸려 중단했어요. 문장을 짧게 나누거나 다시 시도해 주세요.'));
    }, milliseconds);
  }
  async function analyze(sentence: string, progress: Progress) {
    if (pending) throw new Error('진행 중인 분석을 먼저 끝내거나 취소해 주세요.');
    worker ??= new Worker(new URL('./pattern.worker.ts', import.meta.url), { type: 'module' });
    return new Promise<SentencePattern>((resolve, reject) => {
      pending = { resolve, reject, progress }; deadline(15 * 60 * 1000);
      const activeWorker = worker, activeRequest = pending;
      worker!.onmessage = event => {
        if (!pending || worker !== activeWorker || pending !== activeRequest) return;
        const data = event.data;
        if (data.type === 'progress') pending.progress('loading', data.progress);
        if (data.type === 'analyzing') { deadline(90 * 1000); pending.progress('analyzing'); }
        if (data.type === 'result') { const done = pending.resolve; pending = undefined; clearTimeout(timer); done(data.value); }
        if (data.type === 'error' && pending) { const fail = pending.reject; pending = undefined; cancel(); fail(new Error(data.message)); }
      };
      worker!.onerror = () => {
        if (worker !== activeWorker || pending !== activeRequest) return;
        const fail = pending?.reject; pending = undefined; cancel();
        fail?.(new Error('분석 실행이 중단되었어요. 다른 GPU 작업을 줄이거나 다시 시도해 주세요.'));
      };
      worker!.postMessage({ sentence });
    });
  }
  return { analyze, cancel };
}
