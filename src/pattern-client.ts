import { parsePattern } from './sentence-pattern';

export const defaultPatternServer = 'http://127.0.0.1:4175';
export function patternServer(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('분석 연결 주소를 확인해 주세요. 예: http://127.0.0.1:4175'); }
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)))) throw new Error('이 PC의 http://127.0.0.1 주소 또는 HTTPS 서버 주소를 입력해 주세요.');
  return url.href.replace(/\/$/, '');
}
const headers = { 'Content-Type': 'application/json', 'X-Leaf-Client': 'sentence-pattern' };
export async function checkPatternServer(base: string, signal?: AbortSignal): Promise<{ model: string; cpu: boolean }> {
  const response = await fetch(patternServer(base) + '/health', { headers, signal: signal || AbortSignal.timeout(6000), credentials: 'omit' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Ollama 연결을 확인해 주세요.');
  if (result.service !== 'leaf-sentence-pattern' || typeof result.model !== 'string') throw new Error('Leaf 분석 연결 프로그램의 주소가 아닙니다.');
  return result;
}
export function createPatternClient() {
  let active: AbortController | undefined;
  function cancel() { active?.abort(); active = undefined; }
  async function analyze(sentence: string, progress: (stage: 'loading' | 'analyzing') => void, base = defaultPatternServer) {
    if (active) throw new Error('진행 중인 분석을 먼저 끝내거나 취소해 주세요.');
    const controller = new AbortController(); active = controller;
    const timer = window.setTimeout(() => controller.abort(), 190000);
    try {
      progress('loading');
      await checkPatternServer(base, AbortSignal.any([controller.signal, AbortSignal.timeout(6000)]));
      if (controller.signal.aborted) throw controller.signal.reason;
      progress('analyzing');
      const response = await fetch(patternServer(base) + '/analyze', { method: 'POST', headers, credentials: 'omit', signal: controller.signal, body: JSON.stringify({ sentence }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '분석하지 못했어요. Ollama 상태를 확인해 주세요.');
      return parsePattern(JSON.stringify(result));
    } catch (error) {
      if (controller.signal.aborted) throw new Error('분석이 취소되거나 제한 시간을 넘었어요.');
      if (error instanceof Error && /[가-힣]/.test(error.message)) throw error;
      throw new Error('Ollama 연결 프로그램을 실행하고 주소를 확인해 주세요. 브라우저에서 로컬 네트워크 접근을 물으면 허용해 주세요.');
    } finally { clearTimeout(timer); if (active === controller) active = undefined; }
  }
  return { analyze, cancel };
}
