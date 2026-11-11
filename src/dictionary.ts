type LocalDictionary = {
  metadata: { version: string; entries: number };
  entries: [string, string][];
  lookup: Record<string, number[]>;
};
type Definition = { definition: string; example?: string };
type EnglishEntry = {
  word: string; phonetic?: string;
  phonetics?: { text?: string }[];
  meanings: { partOfSpeech: string; definitions: Definition[] }[];
  sourceUrls?: string[];
};
export function normalizeWord(value: string) {
  return value.normalize('NFKC').trim().replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '').toLowerCase();
}
function element<K extends keyof HTMLElementTagNameMap>(tag: K, value: string, className?: string) {
  const node = document.createElement(tag); node.textContent = value;
  if (className) node.className = className;
  return node;
}
function message(panel: HTMLElement, value: string) { panel.replaceChildren(element('p', value, 'muted')); }
let localPromise: Promise<LocalDictionary> | undefined;
const cache = new Map<string, EnglishEntry[] | null>();
function localDictionary() {
  return localPromise ??= fetch('/dictionary/en-ko.json').then(r => {
    if (!r.ok) throw new Error('Dictionary unavailable');
    return r.json();
  }).catch(error => { localPromise = undefined; throw error; });
}
export function setupDictionary() {
  const form = document.querySelector<HTMLFormElement>('#dictionary-form')!;
  const input = document.querySelector<HTMLInputElement>('#word-input')!;
  const title = document.querySelector<HTMLElement>('#word-title')!;
  const en = document.querySelector<HTMLElement>('#english-result')!;
  const ko = document.querySelector<HTMLElement>('#korean-result')!;
  const recent = document.querySelector<HTMLElement>('#recent-words')!;
  let sequence = 0;
  let abort: AbortController | undefined;
  const history: string[] = [];
  void localDictionary().catch(() => {});
  async function search(value: string) {
    const word = normalizeWord(value);
    if (!word || word.length > 100 || !/^[a-z][a-z'’ -]*$/.test(word)) {
      input.setCustomValidity('영어 단어 또는 짧은 구문을 입력하세요.'); input.reportValidity(); return;
    }
    input.setCustomValidity('');
    const token = ++sequence;
    abort?.abort();
    abort = new AbortController();
    const signal = abort.signal;
    input.value = word; title.textContent = word;
    document.querySelector('#dictionary-empty')!.setAttribute('hidden', '');
    document.querySelector('#dictionary-content')!.removeAttribute('hidden');
    message(en, '영영 뜻을 찾고 있어요…'); message(ko, '영한 뜻을 찾고 있어요…');
    const index = history.indexOf(word); if (index >= 0) history.splice(index, 1);
    history.unshift(word); history.splice(7);
    recent.replaceChildren(...history.map(w => {
      const button = element('button', w, 'word-chip'); button.type = 'button';
      button.onclick = () => void search(w); return button;
    }));
    void localDictionary().then(dictionary => {
      if (token !== sequence) return;
      const ids = Object.hasOwn(dictionary.lookup, word) ? dictionary.lookup[word] : [];
      if (!ids.length) { message(ko, '등록된 영한 뜻이 없어요. 다른 형태의 단어로 검색해 보세요.'); return; }
      ko.replaceChildren();
      for (const id of ids) {
        const [headword, html] = dictionary.entries[id];
        const article = element('article', '', 'local-entry');
        if (headword.toLowerCase() !== word) article.append(element('p', '기본형 · ' + headword, 'base-word'));
        const parsed = new DOMParser().parseFromString(html, 'text/html');
        const names: Record<string, string> = { 'n.':'명사', 'v.':'동사', 'adj.':'형용사', 'adv.':'부사', 'pron.':'대명사', 'prep.':'전치사', 'conj.':'접속사', 'interj.':'감탄사', 'det.':'한정사', 'num.':'수사', 'suf.':'접미사', 'pref.':'접두사', 'art.':'관사', 'phrase':'구문' };
        for (const block of parsed.body.children) {
          const translations = [...block.querySelectorAll('b,strong')];
          if (!translations.length) continue;
          const part = block.querySelector('i')?.textContent?.trim() || '';
          const group = element('section', '', 'ko-meaning-group');
          if (part) group.append(element('span', names[part] || part, 'ko-pos'));
          const list = element('ol', '', 'ko-meanings');
          for (const translation of translations) {
            const row = element('li', '', 'ko-meaning');
            row.append(element('strong', translation.textContent || '', 'ko-translation'));
            const details = element('details', '', 'ko-explanation');
            let next = translation.nextElementSibling;
            const explanation: string[] = [];
            while (next && !['B', 'STRONG', 'BR'].includes(next.tagName)) {
              const text = next.textContent?.trim() || '';
              if (/^[—–]/.test(text)) explanation.push(text.replace(/^[—–]\\s*/, ''));
              next = next.nextElementSibling;
            }
            if (explanation.length) {
              details.append(element('summary', '자세한 영문 설명'));
              details.append(element('p', explanation.join(' ')));
              row.append(details);
            }
            list.append(row);
          }
          group.append(list); article.append(group);
        }
        if (!article.querySelector('.ko-translation')) article.append(element('p', parsed.body.textContent || '뜻이 없어요.'));
        ko.append(article);
      }
    }).catch(() => {
      if (token === sequence) message(ko, '영한 사전 파일을 읽지 못했어요. 앱을 다시 실행한 뒤 검색해 주세요.');
    });
    const renderEnglish = (entries: EnglishEntry[] | null) => {
      if (token !== sequence) return;
      if (!entries) { message(en, '등록된 영영 뜻이 없어요. 다른 형태의 단어로 검색해 보세요.'); return; }
      en.replaceChildren();
      for (const entry of entries) {
        const phonetic = entry.phonetic || entry.phonetics?.find(p => p.text)?.text;
        if (phonetic) en.append(element('p', phonetic, 'phonetic'));
        for (const meaning of entry.meanings) {
          en.append(element('span', meaning.partOfSpeech, 'pos'));
          const list = document.createElement('ol');
          for (const definition of meaning.definitions.slice(0, 5)) {
            const item = element('li', definition.definition);
            if (definition.example) item.append(element('p', definition.example, 'example'));
            list.append(item);
          }
          en.append(list);
        }
        const source = entry.sourceUrls?.find(url => url.startsWith('https://'));
        if (source) { const link = element('a', '정의 출처 ↗', 'source-link'); link.href = source; link.target = '_blank'; link.rel = 'noopener noreferrer'; en.append(link); }
      }
    };
    if (cache.has(word)) { renderEnglish(cache.get(word)!); return; }
    const timeout = window.setTimeout(() => abort?.signal === signal && abort.abort(), 12000);
    try {
      const response = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word), { signal });
      if (response.status === 404) { cache.set(word, null); renderEnglish(null); return; }
      if (!response.ok) throw new Error('API error');
      const entries: EnglishEntry[] = await response.json();
      cache.set(word, entries); renderEnglish(entries);
    } catch {
      if (token === sequence) message(en, '영영 사전에 연결할 수 없어요. 인터넷 연결을 확인한 뒤 다시 검색해 주세요. 영한 사전은 계속 사용할 수 있어요.');
    } finally { clearTimeout(timeout); }
  }
  form.onsubmit = event => { event.preventDefault(); void search(input.value); };
  input.oninput = () => input.setCustomValidity('');
  return search;
}
