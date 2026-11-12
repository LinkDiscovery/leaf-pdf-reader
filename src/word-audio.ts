export type WordAudio = ReturnType<typeof setupWordAudio>;

export function setupWordAudio(notify: (message: string) => void) {
  const supported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  const synth = supported ? window.speechSynthesis : undefined;
  let active: { button: HTMLButtonElement; utterance: SpeechSynthesisUtterance } | undefined;
  let timer = 0;
  function label(button: HTMLButtonElement, playing: boolean) {
    button.textContent = playing ? '■ 멈추기' : '🔊 듣기';
    button.setAttribute('aria-label', `${button.dataset.word} 발음 ${playing ? '멈추기' : '듣기'}`);
    button.setAttribute('aria-pressed', String(playing));
  }
  function clear() {
    clearTimeout(timer);
    if (active) label(active.button, false);
    active = undefined;
  }
  function stop() {
    if (!active) return;
    clear(); // Ignore late cancellation events from the previous utterance.
    try { synth?.cancel(); } catch {}
  }
  function stopWithin(element: Element) { if (active && element.contains(active.button)) stop(); }
  function createButton(value: string) {
    const word = value.replace(/\s+/g, ' ').trim();
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'word-audio text-button'; button.dataset.word = word;
    label(button, false);
    button.title = '영어 발음 듣기 · 다시 누르면 멈춥니다';
    if (!supported) {
      button.disabled = true; button.textContent = '음성 미지원';
      button.title = '이 브라우저에서는 음성 읽기를 지원하지 않습니다.';
    } else if (!/[a-z]/i.test(word) || word.length > 100) {
      button.disabled = true; button.title = '100자 이내의 영어 단어·짧은 표현을 들을 수 있어요.';
    }
    button.onclick = () => {
      const same = active?.button === button;
      stop();
      if (same || !synth) return;
      try {
        const voices = synth.getVoices();
        const english = voices.filter(voice => /^en(?:[-_]|$)/i.test(voice.lang));
        if (voices.length && !english.length) { notify('영어 음성을 찾지 못했어요. 기기나 브라우저에 영어 음성을 추가해 주세요.'); return; }
        const voice = english.find(voice => voice.localService && /^en[-_]US$/i.test(voice.lang))
          || english.find(voice => voice.localService) || english.find(voice => /^en[-_]US$/i.test(voice.lang)) || english[0];
        const utterance = new SpeechSynthesisUtterance(word);
        utterance.lang = voice?.lang || 'en-US';
        if (voice) utterance.voice = voice;
        utterance.rate = 1; utterance.pitch = 1; utterance.volume = 1;
        active = { button, utterance }; label(button, true);
        utterance.onend = () => { if (active?.utterance === utterance) clear(); };
        utterance.onerror = event => {
          if (active?.utterance !== utterance) return;
          clear();
          if (!['canceled', 'interrupted'].includes(event.error)) notify('발음을 재생하지 못했어요. 기기의 영어 음성과 오디오 설정을 확인한 뒤 다시 눌러 주세요.');
        };
        timer = window.setTimeout(() => {
          if (active?.utterance !== utterance) return;
          stop(); notify('음성 재생이 응답하지 않아요. 영어 음성 설정을 확인하고 다시 시도해 주세요.');
        }, 20000);
        synth.speak(utterance);
      } catch {
        stop(); notify('발음을 재생하지 못했어요. 다른 브라우저에서 다시 시도해 주세요.');
      }
    };
    return button;
  }
  // Voice lists may load asynchronously; read the current list on every click.
  try { synth?.getVoices(); } catch {}
  window.addEventListener('pagehide', stop);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  return { createButton, stop, stopWithin };
}
