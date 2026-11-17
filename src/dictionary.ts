import { addSearch, boundedSenses, canonicalPos, historyKey, initializeSelection, lookupDraft, posLabels, restoreHistory, selection, senseKey, setSelection, visibleSenses, type Language, type Lookup, type ReadingSource, type SearchRecord, type Sense } from './dictionary-history';
import { emptyDraft, type StudyDraft } from './study-model';
import type { WordAudio } from './word-audio';
let studyDraft: StudyDraft = emptyDraft('word');
export function dictionaryStudyDraft(): StudyDraft { return { ...studyDraft }; }
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
type OnlineKoreanGroup = {
  pos: string;
  items: { meaning: string; synonyms: string[] }[];
};
type OnlineKoreanResult = {
  primary: string;
  groups: OnlineKoreanGroup[];
};
export function normalizeWord(value: string) {
  return value.normalize('NFKC').trim().replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '').toLowerCase();
}
function normalizeSentence(value: string) {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}
function element<K extends keyof HTMLElementTagNameMap>(tag: K, value: string, className?: string) {
  const node = document.createElement(tag); node.textContent = value;
  if (className) node.className = className;
  return node;
}
function message(panel: HTMLElement, value: string) { panel.replaceChildren(element('p', value, 'muted')); }
let localPromise: Promise<LocalDictionary> | undefined;
const cache = new Map<string, EnglishEntry[] | null>();
const koCache = new Map<string, OnlineKoreanResult | null>();
function localDictionary() {
  return localPromise ??= fetch(import.meta.env.BASE_URL + 'dictionary/en-ko.json').then(r => {
    if (!r.ok) throw new Error('Dictionary unavailable');
    return r.json();
  }).catch(error => { localPromise = undefined; throw error; });
}
export async function normalizeReadingText(value: string) {
  const text = value.replace(/\u00ad\s*/g, '');
  if (!/[a-z]-\s*[a-z]/i.test(text)) return text;
  try {
    const dictionary = await localDictionary();
    return text.replace(/\b([a-z]+)-\s*([a-z]+)\b/gi, (original, left: string, right: string) => {
      const compound = (left + '-' + right).toLowerCase(), joined = (left + right).toLowerCase();
      if (Object.hasOwn(dictionary.lookup, compound)) return left + '-' + right;
      return Object.hasOwn(dictionary.lookup, joined) ? left + right : original;
    });
  } catch { return text; }
}
function parseOnlineKorean(raw: unknown, queryWord: string): OnlineKoreanResult | null {
  if (!Array.isArray(raw)) return null;
  const primary = Array.isArray(raw[0])
    ? raw[0].map((part: unknown) => Array.isArray(part) && typeof part[0] === 'string' ? part[0] : '').join('').trim()
    : '';
  const groups: OnlineKoreanGroup[] = [];
  if (Array.isArray(raw[1])) {
    for (const group of raw[1]) {
      if (!Array.isArray(group)) continue;
      const pos = typeof group[0] === 'string' ? group[0] : '';
      const details = Array.isArray(group[2]) ? group[2] : [];
      const terms = Array.isArray(group[1]) ? group[1] : [];
      const items: { meaning: string; synonyms: string[] }[] = [];
      if (details.length) {
        for (const item of details.slice(0, 6)) {
          if (Array.isArray(item) && typeof item[0] === 'string') {
            const synonyms = Array.isArray(item[1]) ? item[1].filter((s): s is string => typeof s === 'string') : [];
            items.push({ meaning: item[0], synonyms });
          }
        }
      } else {
        for (const term of terms.slice(0, 6)) {
          if (typeof term === 'string') items.push({ meaning: term, synonyms: [] });
        }
      }
      if (items.length) groups.push({ pos, items });
    }
  }
  const hasKorean = /[가-힣]/.test(primary) || groups.some(g => g.items.some(i => /[가-힣]/.test(i.meaning)));
  if (!hasKorean && primary.toLowerCase() === queryWord.toLowerCase()) return null;
  if (!primary && !groups.length) return null;
  return { primary, groups };
}
export function setupDictionary(audio: WordAudio) {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const form = $<HTMLFormElement>('dictionary-form'), input = $<HTMLInputElement>('word-input'), title = $('word-title');
  const heading = element('div', '', 'dictionary-word-heading'); title.before(heading); heading.append(title);
  const audioSlot = element('span', ''); audioSlot.id = 'dictionary-audio'; heading.append(audioSlot);
  const en = $('english-result'), ko = $('korean-result'), recent = $('recent-words');
  const pos = $<HTMLSelectElement>('dictionary-pos'), status = $('dictionary-choice-status');
  let history = restoreHistory(null);
  try { history = restoreHistory(localStorage.getItem(historyKey)); } catch { /* Memory history remains available. */ }
  let sequence = 0, abort: AbortController | undefined;
  void localDictionary().catch(() => {});

  function persist() {
    try { localStorage.setItem(historyKey, JSON.stringify({ version: 1, ...history })); }
    catch { status.textContent = '기기 저장 공간을 사용할 수 없어 검색 기록은 이 화면에서만 유지됩니다.'; }
  }
  function current() { return history.entries[history.index]; }
  function navigation() {
    $<HTMLButtonElement>('dictionary-back').disabled = history.index <= 0;
    $<HTMLButtonElement>('dictionary-forward').disabled = history.index < 0 || history.index >= history.entries.length - 1;
    $('dictionary-position').textContent = history.entries.length ? (history.index + 1) + ' / ' + history.entries.length : '최근 검색 3개';
    $<HTMLButtonElement>('dictionary-history-clear').disabled = !history.entries.length;
    recent.replaceChildren();
    for (let i = history.entries.length - 1; i >= 0; i--) {
      const entry = history.entries[i], button = element('button', entry.query, 'word-chip');
      button.type = 'button'; button.title = entry.query;
      if (i === history.index) button.setAttribute('aria-current', 'true');
      button.onclick = () => { history.index = i; void activate(entry); };
      recent.append(button);
    }
    if (!history.entries.length) recent.append(element('span', '최근 검색 3개와 선택한 뜻을 이 브라우저에 보관해요.', 'muted'));
  }
  function updateChoices(record: SearchRecord) {
    for (const language of ['english', 'korean'] as const) {
      const selected = selection(record, language);
      const counts = new Map<string, number>();
      for (const sense of visibleSenses(record, language)) if (selected.includes(senseKey(sense))) counts.set(sense.pos, (counts.get(sense.pos) || 0) + 1);
      const panel = language === 'english' ? en : ko;
      $(language === 'english' ? 'dictionary-en-count' : 'dictionary-ko-count').textContent = '선택 ' + [...counts.values()].reduce((a, b) => a + b, 0) + '개 · 품사별 3개';
      for (const counter of panel.querySelectorAll<HTMLElement>('[data-count-pos]')) counter.textContent = (counts.get(counter.dataset.countPos || '') || 0) + '/3 선택';
      for (const checkbox of panel.querySelectorAll<HTMLInputElement>('input.meaning-check')) {
        checkbox.checked = selected.includes(checkbox.dataset.key || '');
        checkbox.disabled = (counts.get(checkbox.dataset.pos || '') || 0) >= 3 && !checkbox.checked;
      }
    }
    studyDraft = lookupDraft(record);
    const save = $<HTMLButtonElement>('dictionary-save');
    if (save) { save.hidden = false; save.textContent = record.kind === 'word' ? '＋ 단어장에 저장' : '＋ 문장 모음에 저장'; }
    persist();
  }
  function choice(record: SearchRecord, language: Language, sense: Sense, strong: boolean) {
    const label = element('label', '', 'meaning-choice');
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'meaning-check';
    checkbox.dataset.key = senseKey(sense);
    checkbox.dataset.pos = sense.pos;
    checkbox.setAttribute('aria-label', (language === 'english' ? '영영' : '영한') + ' ' + (posLabels[sense.pos] || '뜻') + ' 선택: ' + sense.text);
    checkbox.onchange = () => {
      const keys = selection(record, language).filter(key => key !== senseKey(sense));
      if (checkbox.checked) keys.push(senseKey(sense));
      setSelection(record, language, keys); updateChoices(record);
      status.textContent = '품사마다 영영·영한 뜻을 각각 3개까지 선택할 수 있어요. 현재 표시된 품사의 체크한 뜻을 저장합니다.';
    };
    label.append(checkbox, element(strong ? 'strong' : 'span', sense.text, strong ? 'ko-translation' : 'en-translation'));
    return label;
  }
  function renderMeanings(record: SearchRecord, language: Language) {
    const panel = language === 'english' ? en : ko, data = record[language];
    panel.replaceChildren();
    if (!data) { message(panel, language === 'english' ? '영영 뜻을 찾고 있어요…' : '영한 뜻을 찾고 있어요…'); return; }
    if (language === 'english') for (const phonetic of data.phonetics || []) panel.append(element('p', phonetic, 'phonetic'));
    const senses = visibleSenses(record, language);
    if (!senses.length) {
      message(panel, record.pos !== 'all' && data.senses.length ? '이 품사의 뜻은 이 사전에 없어요. 저장 창에서 직접 입력할 수 있습니다.' : data.error || '등록된 뜻이 없어요. 다른 형태의 단어로 검색해 보세요.');
      return;
    }
    const groups = new Map<string, Sense[]>();
    for (const sense of senses) { const key = sense.pos; groups.set(key, [...(groups.get(key) || []), sense]); }
    const article = element('article', '', language === 'korean' ? 'local-entry' : 'english-entry');
    for (const [part, items] of groups) {
      const group = element('section', '', language === 'korean' ? 'ko-meaning-group' : 'en-meaning-group');
      group.append(element('span', posLabels[part] || '뜻', language === 'korean' ? 'ko-pos' : 'pos'));
      const counter = element('span', '', 'dictionary-supplement'); counter.dataset.countPos = part; group.append(counter);
      if (items.every(sense => sense.local) && data.label.includes('온라인')) group.append(element('span', '내장 보충', 'dictionary-supplement'));
      const list = element('ol', '', language === 'korean' ? 'ko-meanings' : 'en-meanings');
      for (const sense of items) {
        const row = element('li', '', language === 'korean' ? 'ko-meaning' : 'en-meaning');
        if (sense.headword && sense.headword.toLowerCase() !== record.query.toLowerCase()) row.append(element('p', '기본형 · ' + sense.headword, 'base-word'));
        row.append(choice(record, language, sense, language === 'korean'));
        if (sense.example) row.append(element('p', sense.example, 'example'));
        if (sense.detail) {
          const details = element('details', '', 'ko-explanation');
          details.append(element('summary', '자세한 영문 설명'), element('p', sense.detail)); row.append(details);
        }
        list.append(row);
      }
      group.append(list); article.append(group);
    }
    panel.append(article);
    for (const source of data.sources || []) if (source.startsWith('https://')) {
      const link = element('a', '정의 출처 ↗', 'source-link'); link.href = source; link.target = '_blank'; link.rel = 'noopener noreferrer'; panel.append(link);
    }
  }
  function render(record: SearchRecord) {
    if (current() !== record) return;
    initializeSelection(record, 'english'); initializeSelection(record, 'korean');
    title.textContent = record.query.length > 42 ? record.query.slice(0, 42) + '…' : record.query;
    $('dictionary-empty').hidden = true; $('dictionary-content').hidden = false;
    $('dictionary-picks').hidden = record.kind !== 'word';
    $('dictionary-en-count').hidden = $('dictionary-ko-count').hidden = record.kind !== 'word';
    $('korean-badge').textContent = record.korean?.label || '조회 중';
    if (record.kind === 'word') {
      const available = new Set([...(record.english?.senses || []), ...(record.korean?.senses || [])].map(sense => sense.pos).filter(Boolean));
      pos.replaceChildren();
      const all = element('option', '전체 품사 · 함께 저장'); all.value = 'all'; pos.append(all);
      for (const code of Object.keys(posLabels)) if (available.has(code) || record.pos === code) {
        const option = element('option', posLabels[code] + '만 · 따로 저장'); option.value = code; pos.append(option);
      }
      pos.value = record.pos;
      renderMeanings(record, 'english'); renderMeanings(record, 'korean');
    } else {
      en.replaceChildren(element('p', '문장 속 단어를 누르면 단어 사전으로 이동해요. 뒤로가기로 문장 번역을 다시 볼 수 있어요.', 'muted'));
      const wrap = element('div', '', 'sentence-word-chips');
      for (const word of [...new Set(record.query.split(/[^a-zA-Z'’-]+/).map(normalizeWord).filter(word => word.length >= 2))].slice(0, 18)) {
        const chip = element('button', word, 'word-chip'); chip.type = 'button';
        chip.onclick = () => void search(word, { ...record.source, example: record.query }); wrap.append(chip);
      }
      en.append(wrap);
      message(ko, record.korean?.senses[0]?.text || record.korean?.error || '문장을 번역하고 있어요…');
    }
    navigation(); updateChoices(record);
  }
  pos.onchange = () => {
    const record = current(); if (!record) return;
    record.pos = pos.value;
    status.textContent = pos.value === 'all' ? '모든 품사의 선택한 뜻을 한 카드에 함께 저장합니다. 품사마다 영영·영한 각각 최대 3개예요.' : '현재 품사의 선택한 뜻만 저장합니다. 다른 품사의 선택도 유지되며 전체 품사로 돌아가면 함께 저장할 수 있어요.';
    render(record);
  };
  $('dictionary-back').onclick = () => { if (history.index > 0) { history.index--; void activate(current()); } };
  $('dictionary-forward').onclick = () => { if (history.index < history.entries.length - 1) { history.index++; void activate(current()); } };
  $('dictionary-history-clear').onclick = () => {
    sequence++; abort?.abort(); audio.stop(); audioSlot.replaceChildren(); cache.clear(); koCache.clear();
    history.entries = []; history.index = -1; studyDraft = emptyDraft('word'); input.value = '';
    $('dictionary-content').hidden = true; $('dictionary-empty').hidden = false;
    const save = $('dictionary-save'); if (save) save.hidden = true;
    navigation(); persist();
  };

  async function localSenses(word: string): Promise<Sense[]> {
    try {
      const dictionary: LocalDictionary = await localDictionary();
      const ids = Object.hasOwn(dictionary.lookup, word) ? dictionary.lookup[word] : [];
      const senses: Sense[] = [];
      for (const id of ids) {
        const [headword, html] = dictionary.entries[id];
        const parsed = new DOMParser().parseFromString(html, 'text/html');
        for (const block of parsed.body.children) {
          const part = canonicalPos(block.querySelector('i')?.textContent || '');
          for (const translation of block.querySelectorAll('b,strong')) {
            const explanation: string[] = []; let next = translation.nextElementSibling;
            while (next && !['B', 'STRONG', 'BR'].includes(next.tagName)) {
              const text = next.textContent?.trim() || '';
              if (/^[—–]/.test(text)) explanation.push(text.replace(/^[—–]\s*/, ''));
              next = next.nextElementSibling;
            }
            senses.push({ pos: part, text: translation.textContent || '', detail: explanation.join(' '), headword, local: true });
          }
        }
      }
      return boundedSenses(senses);
    } catch { return []; }
  }
  async function korean(record: SearchRecord, signal: AbortSignal): Promise<Lookup> {
    const local = record.kind === 'word' ? localSenses(record.query) : Promise.resolve([]);
    let online: OnlineKoreanResult | null = null;
    try {
      if (koCache.has(record.query)) online = koCache.get(record.query)!;
      else {
        const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=ko&dt=t&dt=bd&q=' + encodeURIComponent(record.query);
        const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]) });
        if (!response.ok) throw new Error('Korean API error');
        online = parseOnlineKorean(await response.json(), record.query); koCache.set(record.query, online);
        if (koCache.size > 50) koCache.delete(koCache.keys().next().value!);
      }
    } catch { /* Partial/offline results are supplemented below, not treated as complete. */ }
    const offline = await local;
    if (record.kind === 'sentence') return { senses: online?.primary ? [{ pos: '', text: online.primary.slice(0, 4000) }] : [], label: '문장 번역 API', error: '문장 번역에 연결하지 못했어요. 개별 단어는 내장 사전으로 확인할 수 있습니다.' };
    const senses: Sense[] = [];
    if (online) {
      for (const group of online.groups) for (const item of group.items) senses.push({ pos: canonicalPos(group.pos), text: item.meaning, detail: item.synonyms.length ? '유의어 · ' + item.synonyms.join(', ') : '' });
      if (online.primary && !senses.some(sense => sense.text === online!.primary)) senses.unshift({ pos: '', text: online.primary });
    }
    const onlineParts = new Set(senses.map(sense => sense.pos).filter(Boolean));
    const supplement = offline.filter(sense => !onlineParts.has(sense.pos));
    return { senses: boundedSenses([...senses, ...supplement]), label: online ? supplement.length ? '온라인 + 내장 보충' : '온라인 API' : '오프라인 내장', error: '등록된 영한 뜻이 없어요. 다른 형태의 단어로 검색하거나 저장 창에서 직접 입력해 주세요.' };
  }
  async function english(record: SearchRecord, signal: AbortSignal): Promise<Lookup> {
    try {
      let entries = cache.get(record.query);
      if (!cache.has(record.query)) {
        const response = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(record.query), { signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]) });
        if (response.status === 404) entries = null;
        else {
          if (!response.ok) throw new Error('English API error');
          entries = await response.json(); if (!Array.isArray(entries)) throw new Error('Invalid dictionary response');
        }
        cache.set(record.query, entries || null);
        if (cache.size > 50) cache.delete(cache.keys().next().value!);
      }
      const senses: Sense[] = [], phonetics: string[] = [], sources: string[] = [];
      for (const entry of entries || []) {
        const phonetic = entry.phonetic || entry.phonetics?.find(item => item.text)?.text;
        if (typeof phonetic === 'string' && !phonetics.includes(phonetic)) phonetics.push(phonetic.slice(0, 200));
        for (const group of entry.meanings || []) for (const definition of (group.definitions || []).slice(0, 6)) {
          if (typeof definition.definition === 'string') senses.push({ pos: canonicalPos(group.partOfSpeech || ''), text: definition.definition, example: typeof definition.example === 'string' ? definition.example : undefined });
        }
        for (const source of entry.sourceUrls || []) if (typeof source === 'string' && source.startsWith('https://') && !sources.includes(source)) sources.push(source.slice(0, 2000));
      }
      return { senses: boundedSenses(senses), label: '온라인', phonetics: phonetics.slice(0, 10), sources: sources.slice(0, 10) };
    } catch { return { senses: [], label: '온라인', error: '영영 사전에 연결할 수 없어요. 인터넷 연결을 확인한 뒤 다시 검색해 주세요. 영한 사전은 계속 사용할 수 있어요.' }; }
  }
  async function activate(record: SearchRecord) {
    input.setCustomValidity('');
    input.value = record.query;
    const token = ++sequence; abort?.abort(); abort = new AbortController(); const signal = abort.signal;
    audio.stop(); audioSlot.replaceChildren(); if (record.kind === 'word') audioSlot.append(audio.createButton(record.query));
    status.textContent = '품사마다 영영·영한 각각 3개까지 체크하세요. 각 품사의 첫 뜻이 기본 선택되며, 품사를 고르면 해당 품사만 저장합니다.';
    render(record);
    await Promise.allSettled((['english', 'korean'] as const).map(async language => {
      if (record[language] || (language === 'english' && record.kind === 'sentence')) return;
      const result = await (language === 'english' ? english(record, signal) : korean(record, signal));
      if (token !== sequence || signal.aborted) return;
      record[language] = result; render(record);
    }));
  }
  async function search(value: string, source?: ReadingSource) {
    const original = value;
    if (/[-\u00ad]/.test(value)) {
      const token = ++sequence; abort?.abort();
      value = await normalizeReadingText(value);
      if (token !== sequence) return;
    }
    const cleaned = normalizeSentence(value), word = normalizeWord(value);
    const isWord = word.length > 0 && word.length <= 100 && /^[a-z][a-z'’ -]*$/.test(word) && word.split(/\s+/).length <= 3;
    if (!isWord && !(cleaned.length > 0 && cleaned.length <= 1000 && /[a-zA-Z]/.test(cleaned))) {
      input.setCustomValidity('영어 단어 또는 짧은 구문을 입력하세요.'); input.reportValidity(); return;
    }
    input.setCustomValidity('');
    const record: SearchRecord = { id: crypto.randomUUID(), query: isWord ? word : cleaned, kind: isWord ? 'word' : 'sentence', pos: 'all', source: {
      source: (source?.source || '').slice(0, 500), page: source?.page || 0, example: (source?.example || '').slice(0, 4000),
    } };
    addSearch(history, record); const pending = activate(record);
    if (original !== value) status.textContent = '하이픈을 정리했어요: ' + normalizeSentence(original) + ' → ' + record.query + '. 품사마다 영영·영한 각각 3개까지 선택하세요.';
    await pending;
  }
  form.onsubmit = event => { event.preventDefault(); void search(input.value); };
  input.oninput = () => input.setCustomValidity('');
  navigation();
  if (current()) queueMicrotask(() => void activate(current()));
  return search;
}
