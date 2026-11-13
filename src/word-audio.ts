export type WordAudio = ReturnType<typeof setupWordAudio>;

export function setupWordAudio(notify: (message: string) => void) {
  const supported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  const synth = supported ? window.speechSynthesis : undefined;
  type Playback = { button: HTMLButtonElement; utterance?: SpeechSynthesisUtterance; audio?: HTMLAudioElement; abort?: AbortController };
  let active: Playback | undefined;
  const recordings = new Map<string, string[]>();
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
    const previous = active;
    clear(); // Ignore late cancellation events from the previous utterance.
    previous.abort?.abort(); previous.audio?.pause();
    if (previous.utterance) { try { synth?.cancel(); } catch {} }
  }
  function stopWithin(element: Element) { if (active && element.contains(active.button)) stop(); }
  async function playRecording(word: string, button: HTMLButtonElement) {
    const playback: Playback = { button, abort: new AbortController() };
    active = playback; label(button, true);
    const fail = () => {
      if (active !== playback) return;
      stop(); notify('이 단어의 발음을 재생하지 못했어요. 인터넷 연결을 확인하거나 기기에 영어 음성을 추가해 주세요.');
    };
    timer = window.setTimeout(fail, 15000);
    try {
      const key = word.toLowerCase();
      let urls = recordings.get(key);
      if (!urls) {
        urls = [];
        // Try dictionary recording variants; missing files fall through to the next URL.
        if (/^[a-z]+$/.test(key)) urls.push(`https://ssl.gstatic.com/dictionary/static/sounds/20200429/${key}--_us_1.mp3`, `https://ssl.gstatic.com/dictionary/static/sounds/20200429/${key}--_gb_1.mp3`);
        try {
          const response = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(key), { signal: playback.abort!.signal });
          const entries: unknown = response.ok ? await response.json() : [];
          if (Array.isArray(entries)) for (const entry of entries) {
            if (!Array.isArray(entry?.phonetics)) continue;
            for (const phonetic of entry.phonetics) {
              if (typeof phonetic?.audio !== 'string' || !phonetic.audio) continue;
              try {
                const candidate = new URL(phonetic.audio, 'https://api.dictionaryapi.dev');
                if (candidate.protocol === 'https:' && ['api.dictionaryapi.dev', 'ssl.gstatic.com'].includes(candidate.hostname)) urls.push(candidate.href);
              } catch {}
            }
          }
        } catch { /* Try the public dictionary recordings even if lookup is unavailable. */ }
        urls = [...new Set(urls)];
      }
      for (const url of urls) {
        if (active !== playback) return;
        const audio = new Audio(url); playback.audio = audio;
        const signal = playback.abort!.signal;
        let cancel: () => void = () => {};
        try {
          await new Promise<void>((resolve, reject) => {
            cancel = () => reject(new Error('Canceled'));
            signal.addEventListener('abort', cancel, { once: true });
            audio.onended = () => resolve(); audio.onerror = () => reject(new Error('Recording unavailable'));
            audio.play().catch(reject);
          });
          if (active === playback) { recordings.set(key, [url, ...urls.filter(other => other !== url)]); clear(); }
          return;
        } catch {
          audio.pause();
          if (active !== playback) return;
        } finally { signal.removeEventListener('abort', cancel); }
      }
      fail();
    } catch { fail(); }
  }
  function createButton(value: string) {
    const word = value.replace(/\s+/g, ' ').trim();
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'word-audio text-button'; button.dataset.word = word;
    label(button, false);
    button.title = '영어 발음 듣기 · 다시 누르면 멈춥니다';
    if (!/[a-z]/i.test(word) || word.length > 100) {
      button.disabled = true; button.title = '100자 이내의 영어 단어·짧은 표현을 들을 수 있어요.';
    }
    button.onclick = () => {
      const same = active?.button === button;
      stop();
      if (same) return;
      if (!synth) { void playRecording(word, button); return; }
      try {
        const voices = synth.getVoices();
        const english = voices.filter(voice => /^en(?:[-_]|$)/i.test(voice.lang));
        if (!english.length) { void playRecording(word, button); return; }
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
          if (!['canceled', 'interrupted'].includes(event.error)) void playRecording(word, button);
        };
        timer = window.setTimeout(() => {
          if (active?.utterance !== utterance) return;
          stop(); void playRecording(word, button);
        }, 20000);
        synth.speak(utterance);
      } catch {
        stop(); void playRecording(word, button);
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
